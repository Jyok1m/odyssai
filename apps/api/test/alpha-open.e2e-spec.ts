import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { PRISMA } from './../src/prisma/prisma.module.js';
import { REDIS } from './../src/redis/redis.module.js';
import { FakeRedis } from './../src/auth/testing/doubles.js';
import { GenerationQueueService } from './../src/onboarding/generation-queue.service.js';
import {
  makeOnboardingPrisma,
  makeUser,
  type OnboardingStore,
} from './../src/onboarding/testing/doubles.js';

const SESSION_ID = 'session-de-test';
const COOKIE = `odyssai_session=${SESSION_ID}`;

let app: INestApplication<App> | null = null;

async function boot(options: { isAdmin: boolean; phase: 'preregistration' | 'open' }) {
  const store: OnboardingStore = {
    users: [makeUser({ username: 'Joueuse', usernameFolded: 'joueuse', isAdmin: options.isAdmin })],
    universes: [],
    characters: [],
    messages: [],
    jobs: [],
    siteSettings: {
      id: true,
      alphaPhase: options.phase,
      alphaNotice: false,
      salesOpen: false,
      updatedAt: new Date(0),
    },
  };

  const redis = new FakeRedis();
  await redis.set(
    `odyssai:session:${SESSION_ID}`,
    JSON.stringify({
      sub: store.users[0]!.keycloakId,
      userId: store.users[0]!.id,
      email: store.users[0]!.email,
      emailVerified: true,
      roles: [],
      accessToken: 'jeton-acces',
      refreshToken: 'jeton-refresh',
      idToken: 'jeton-id',
      accessExpiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: Date.now() + 7_200_000,
    }),
    'EX',
    3600,
  );

  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(PRISMA)
    .useValue(makeOnboardingPrisma(store))
    .overrideProvider(GenerationQueueService)
    .useValue({ enqueue: async () => {}, onApplicationShutdown: async () => {} })
    .compile();

  app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.use(cookieParser());
  await app.init();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = null;
});

/*
  L'ouverture du jeu est une phase reglee au tableau de bord, et c'est l'api
  qui la tient : le web ne fait qu'en parler. Le compte, lui, reste lisible
  porte fermee, la place du joueur y est.
*/
describe('Ouverture du jeu (e2e)', () => {
  it.each([
    ['get', '/onboarding'],
    ['get', '/stories'],
    ['get', '/turn'],
    ['get', '/worlds/open'],
  ])('ferme %s %s a un joueur ordinaire tant que la phase est la pre-inscription', async (method, path) => {
    const server = (await boot({ isAdmin: false, phase: 'preregistration' })).getHttpServer();

    const response = await (request(server) as any)[method](path).set('Cookie', COOKIE);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('alpha_closed');
  });

  it('laisse le compte lisible porte fermee', async () => {
    const server = (await boot({ isAdmin: false, phase: 'preregistration' })).getHttpServer();

    expect((await request(server).get('/me').set('Cookie', COOKIE)).status).toBe(200);
  });

  it('laisse entrer un administrateur porte fermee', async () => {
    const server = (await boot({ isAdmin: true, phase: 'preregistration' })).getHttpServer();

    expect((await request(server).get('/onboarding').set('Cookie', COOKIE)).status).toBe(200);
  });

  it('laisse entrer tout le monde une fois la phase ouverte', async () => {
    const server = (await boot({ isAdmin: false, phase: 'open' })).getHttpServer();

    expect((await request(server).get('/onboarding').set('Cookie', COOKIE)).status).toBe(200);
  });
});
