import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { GENERATION_QUEUE } from '@odyssai/schemas';
import type { AppConfig } from '../config/app-config.js';
import { connectLiveRedis, runId } from '../redis/testing/live-redis.js';
import {
  ENQUEUE_TIMEOUT_MS,
  GenerationQueueService,
} from './generation-queue.service.js';

function config(queuePrefix: string): AppConfig {
  return { queuePrefix } as unknown as AppConfig;
}

// Un port ou personne n'ecoute : Redis est tombe.
function deadRedis(): Redis {
  const client = new Redis('redis://127.0.0.1:1/0', {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    connectTimeout: 5_000,
  });
  client.on('error', () => {});
  return client;
}

/*
  Le producteur ne fait pas attendre le joueur : un Redis mort echoue vite,
  un Redis qui ne repond pas echoue au bout du delai, et dans les deux cas la
  requete continue, la ligne generation_jobs etant deja ecrite.
*/
describe('file de generation sans Redis', () => {
  const services: GenerationQueueService[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(services.splice(0).map((service) => service.onApplicationShutdown()));
  });

  it('rend la main vite sur un Redis tombe, sans rejet orphelin', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const service = new GenerationQueueService(deadRedis(), config('bull-test'));
    services.push(service);

    const started = Date.now();
    await expect(service.enqueue('univers')).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(ENQUEUE_TIMEOUT_MS);

    await new Promise((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('abandonne au bout du delai un Redis qui ne repond pas', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const service = new GenerationQueueService(deadRedis(), config('bull-test'));
    services.push(service);
    const add = vi
      .spyOn(Queue.prototype, 'add')
      .mockImplementation(() => new Promise(() => {}));

    let settled = false;
    const pending = service.enqueue('univers').then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(ENQUEUE_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
    add.mockRestore();
  });
});

const redis = await connectLiveRedis();
const prefix = `bull-${runId()}`;

describe.skipIf(!redis)('file de generation, Redis reel', () => {
  afterAll(async () => {
    const queue = new Queue(GENERATION_QUEUE, { prefix, connection: redis!.duplicate() });
    await queue.obliterate({ force: true });
    await queue.close();
    await redis!.quit();
  });

  it('publie le travail sous l identifiant de l univers', async () => {
    const service = new GenerationQueueService(redis!, config(prefix));

    await service.enqueue('univers-1');
    await service.enqueue('univers-1');
    await service.onApplicationShutdown();

    const queue = new Queue(GENERATION_QUEUE, { prefix, connection: redis!.duplicate() });
    const job = await queue.getJob('univers-1');
    expect(job?.data).toEqual({ universeId: 'univers-1' });
    expect(await queue.getJobCountByTypes('waiting')).toBe(1);
    await queue.close();
  });
});
