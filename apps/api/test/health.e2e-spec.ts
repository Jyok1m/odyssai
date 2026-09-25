import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { FakeRedis } from './../src/auth/testing/doubles.js';
import { GenerationQueueService } from './../src/onboarding/generation-queue.service.js';
import { PRISMA } from './../src/prisma/prisma.module.js';
import { REDIS } from './../src/redis/redis.module.js';

let app: INestApplication<App> | null = null;

async function boot(options: { redisUp: boolean; postgresUp: boolean }) {
  const reject = () => Promise.reject(new Error('injoignable'));

  /*
    FakeRedis plutot qu'un objet nu : BullMQ duplique la connexion au
    demarrage du module, et un double reduit a `ping` ferait tomber le
    montage avant d'atteindre la sonde.
  */
  const redis = Object.assign(new FakeRedis(), {
    ping: options.redisUp ? async () => 'PONG' : reject,
    quit: async () => 'OK',
  });

  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(PRISMA)
    .useValue({
      $queryRaw: options.postgresUp ? async () => [{ ok: 1 }] : reject,
      $disconnect: async () => {},
    })
    .overrideProvider(GenerationQueueService)
    .useValue({ enqueue: async () => {}, onApplicationShutdown: async () => {} })
    .compile();

  app = moduleFixture.createNestApplication<INestApplication<App>>();
  await app.init();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = null;
});

/*
  Le controle de sante d'avant visait `/`, qui rend « Hello World! » sans rien
  consulter : un conteneur dont la base etait injoignable se declarait sain, et
  Traefik continuait de lui router des joueurs. Ces deux cas tiennent la
  distinction entre « le processus repond » et « il peut servir ».
*/
describe('Sondes de sante (e2e)', () => {
  it('repond a la sonde de vie sans toucher aux dependances', async () => {
    const server = (await boot({ redisUp: false, postgresUp: false })).getHttpServer();

    const response = await request(server).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('rend 200 quand Redis et Postgres repondent', async () => {
    const server = (await boot({ redisUp: true, postgresUp: true })).getHttpServer();

    const response = await request(server).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      checks: { redis: 'up', postgres: 'up' },
    });
  });

  it.each([
    ['Redis', { redisUp: false, postgresUp: true }],
    ['Postgres', { redisUp: true, postgresUp: false }],
    ['les deux', { redisUp: false, postgresUp: false }],
  ])('rend 503 quand %s tombe', async (_name, options) => {
    const server = (await boot(options)).getHttpServer();

    const response = await request(server).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('degraded');
  });

  // Le corps sert a qui vient voir ; la raison de l'echec reste au journal.
  it('ne decrit jamais la panne dans la reponse', async () => {
    const server = (await boot({ redisUp: false, postgresUp: false })).getHttpServer();

    const response = await request(server).get('/health/ready');

    expect(JSON.stringify(response.body)).not.toContain('injoignable');
  });
});
