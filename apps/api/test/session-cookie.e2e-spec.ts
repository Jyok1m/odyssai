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
const REFRESH_LIFETIME_MS = 1_800_000;

let app: INestApplication<App> | null = null;

async function boot() {
  const store: OnboardingStore = {
    users: [makeUser({ username: 'Joueuse', usernameFolded: 'joueuse' })],
    universes: [],
    characters: [],
    messages: [],
    jobs: [],
    siteSettings: {
      id: true,
      alphaPhase: 'open',
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
      refreshExpiresAt: Date.now() + REFRESH_LIFETIME_MS,
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

function sessionCookie(headers: Record<string, unknown>): string | undefined {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : [];
  return list.find((value) => value.startsWith('odyssai_session='));
}

/*
  Le cookie de session etait pose a l'ouverture et jamais reecrit : il expirait
  avec le premier refresh token, une demi-heure plus tard, meme pour un joueur
  qui n'avait pas cesse de jouer. La cle Redis, elle, etait bien prolongee a
  chaque renouvellement, ce qui rendait la panne invisible cote serveur.
*/
describe('Cookie de session (e2e)', () => {
  it('prolonge le cookie a chaque requete gardee', async () => {
    const server = (await boot()).getHttpServer();

    const response = await request(server).get('/onboarding').set('Cookie', COOKIE);

    expect(response.status).toBe(200);
    const cookie = sessionCookie(response.headers as Record<string, unknown>);
    expect(cookie).toBeDefined();
    expect(cookie).toContain(`odyssai_session=${SESSION_ID}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/');

    // Le cookie vise l'echeance de la session, pas une duree fixe : a la
    // seconde de traitement pres, c'est ce qui reste au refresh token.
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookie ?? '')?.[1]);
    expect(maxAge).toBeGreaterThan(REFRESH_LIFETIME_MS / 1000 - 10);
    expect(maxAge).toBeLessThanOrEqual(REFRESH_LIFETIME_MS / 1000);
  });

  it('ne pose aucun cookie quand la session est inconnue', async () => {
    const server = (await boot()).getHttpServer();

    const response = await request(server)
      .get('/onboarding')
      .set('Cookie', 'odyssai_session=identifiant-invente');

    expect(response.status).toBe(401);
    expect(sessionCookie(response.headers as Record<string, unknown>)).toBeUndefined();
  });
});
