import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@odyssai/db';
import { HealthService } from './health.service.js';

function makeService(options: {
  redis: () => PromiseLike<unknown>;
  postgres: () => PromiseLike<unknown>;
}): HealthService {
  const redis = { ping: options.redis } as unknown as Redis;
  const prisma = { $queryRaw: options.postgres } as unknown as PrismaClient;
  return new HealthService(redis, prisma);
}

/*
  La sonde de disponibilite decide si Traefik envoie des joueurs sur cette
  copie. Elle doit donc dire non des qu'une dependance manque, et le dire vite.
*/
describe('HealthService', () => {
  it('rend ok quand les deux dependances repondent', async () => {
    const service = makeService({
      redis: () => Promise.resolve('PONG'),
      postgres: () => Promise.resolve([{ '?column?': 1 }]),
    });

    await expect(service.ready()).resolves.toEqual({
      status: 'ok',
      checks: { redis: 'up', postgres: 'up' },
    });
  });

  it.each([
    ['redis', { redis: true, postgres: false }],
    ['postgres', { redis: false, postgres: true }],
  ])('rend degraded quand %s tombe', async (_name, fails) => {
    const service = makeService({
      redis: () =>
        fails.redis ? Promise.reject(new Error('injoignable')) : Promise.resolve('PONG'),
      postgres: () =>
        fails.postgres ? Promise.reject(new Error('injoignable')) : Promise.resolve([]),
    });

    const readiness = await service.ready();

    expect(readiness.status).toBe('degraded');
    expect(readiness.checks.redis).toBe(fails.redis ? 'down' : 'up');
    expect(readiness.checks.postgres).toBe(fails.postgres ? 'down' : 'up');
  });

  /*
    Une dependance qui ne repond jamais est le cas qui compte : sans borne, la
    sonde pendrait, docker la couperait a son propre delai et tiendrait le
    conteneur pour sain jusque la.
  */
  it('rend down plutot que de pendre sur une dependance muette', async () => {
    vi.useFakeTimers();
    try {
      const service = makeService({
        redis: () => new Promise(() => {}),
        postgres: () => Promise.resolve([]),
      });

      const pending = service.ready();
      await vi.advanceTimersByTimeAsync(2_000);

      await expect(pending).resolves.toEqual({
        status: 'degraded',
        checks: { redis: 'down', postgres: 'up' },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
