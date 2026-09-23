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
let store: OnboardingStore;

async function boot() {
  store = {
    users: [makeUser({ username: 'Joueuse', usernameFolded: 'joueuse' })],
    universes: [],
    characters: [],
    messages: [],
    jobs: [],
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
  return app.getHttpServer();
}

afterEach(async () => {
  await app?.close();
  app = null;
});

// Un pixel PNG : assez pour que multer et le service aient quelque chose a lire.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('Rapport de bug (e2e)', () => {
  it('enregistre le rapport avec sa capture, et qui l a envoye', async () => {
    const server = await boot();

    const response = await request(server)
      .post('/bugs')
      .set('Cookie', COOKIE)
      .set('User-Agent', 'NavigateurDeTest/1.0')
      .field('page', '/play')
      .field('message', "Le bouton d'envoi ne repond plus apres un jet.")
      .attach('screenshot', PIXEL, { filename: 'ecran.png', contentType: 'image/png' });

    expect(response.status).toBe(202);
    expect(store.bugs).toHaveLength(1);
    expect(store.bugs![0]).toMatchObject({
      userId: store.users[0]!.id,
      page: '/play',
      userAgent: 'NavigateurDeTest/1.0',
      screenshotType: 'image/png',
    });
    expect(store.bugs![0]!.screenshot?.byteLength).toBe(PIXEL.byteLength);
  });

  it('accepte un rapport sans capture, et refuse un fichier qui n est pas une image', async () => {
    const server = await boot();

    const plain = await request(server)
      .post('/bugs')
      .set('Cookie', COOKIE)
      .field('page', '/play/stories')
      .field('message', 'La liste des histoires reste vide apres creation.');
    expect(plain.status).toBe(202);

    const refused = await request(server)
      .post('/bugs')
      .set('Cookie', COOKIE)
      .field('page', '/play')
      .field('message', 'Une capture qui n en est pas une.')
      .attach('screenshot', Buffer.from('pas une image'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('invalid_screenshot');
    expect(store.bugs).toHaveLength(1);
  });

  it('refuse un message trop court, et un anonyme', async () => {
    const server = await boot();

    const short = await request(server)
      .post('/bugs')
      .set('Cookie', COOKIE)
      .field('page', '/play')
      .field('message', 'bug');
    expect(short.status).toBe(400);

    const anonymous = await request(server)
      .post('/bugs')
      .field('page', '/play')
      .field('message', 'Un rapport sans session.');
    expect(anonymous.status).toBe(401);
  });
});
