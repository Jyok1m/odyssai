import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  STORIES_MAX,
  type DepartureOutcome,
  type OnboardingState,
  type Stories,
  type Story,
} from '@odyssai/schemas';
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

interface Harness {
  app: INestApplication<App>;
  store: OnboardingStore;
}

async function boot(): Promise<Harness> {
  const store: OnboardingStore = {
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

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.use(cookieParser());
  await app.init();

  return { app, store };
}

function list(app: INestApplication<App>) {
  return request(app.getHttpServer()).get('/stories').set('Cookie', COOKIE);
}

function start(app: INestApplication<App>) {
  return request(app.getHttpServer()).post('/stories').set('Cookie', COOKIE);
}

function select(app: INestApplication<App>, id: string) {
  return request(app.getHttpServer()).put(`/stories/${id}/current`).set('Cookie', COOKIE);
}

function remove(app: INestApplication<App>, id: string) {
  return request(app.getHttpServer()).delete(`/stories/${id}`).set('Cookie', COOKIE);
}

/*
  Plusieurs histoires par joueur. Ce que le parcours lit suit l'histoire
  ouverte, et une histoire effacee ne touche pas aux autres.
*/
describe('/stories (e2e)', () => {
  let app: INestApplication<App>;
  let store: OnboardingStore;

  beforeEach(async () => {
    ({ app, store } = await boot());
  });

  it('refuse un visiteur sans session', async () => {
    await request(app.getHttpServer()).get('/stories').expect(401);
    await app.close();
  });

  it('ne liste rien tant que le joueur n a rien commence', async () => {
    const body = (await list(app).expect(200)).body as Stories;
    expect(body.stories).toEqual([]);
    expect(body.max).toBe(STORIES_MAX);
    await app.close();
  });

  it('commence une histoire et l ouvre aussitot', async () => {
    const story = (await start(app).expect(201)).body as Story;
    expect(story.step).toBe('inspiration');
    expect(story.current).toBe(true);
    expect(store.users[0]!.currentUniverseId).toBe(story.id);

    // Le parcours lit l'histoire ouverte.
    const state = (
      await request(app.getHttpServer()).get('/onboarding').set('Cookie', COOKIE).expect(200)
    ).body as OnboardingState;
    expect(state.universeId).toBe(story.id);
    await app.close();
  });

  it('en ouvre une seconde sans perdre la premiere, puis y revient', async () => {
    const first = (await start(app).expect(201)).body as Story;
    const second = (await start(app).expect(201)).body as Story;
    expect(second.id).not.toBe(first.id);

    let body = (await list(app).expect(200)).body as Stories;
    expect(body.stories.map((story) => story.id)).toEqual([first.id, second.id]);
    expect(body.stories.map((story) => story.current)).toEqual([false, true]);

    const back = (await select(app, first.id).expect(200)).body as Story;
    expect(back.current).toBe(true);

    body = (await list(app).expect(200)).body as Stories;
    expect(body.stories.map((story) => story.current)).toEqual([true, false]);
    await app.close();
  });

  it('refuse d ouvrir l histoire d un autre, sans dire qu elle existe', async () => {
    const other = '01860000-0000-7000-8000-00000000dead';
    store.universes.push({
      id: other,
      ownerId: 'quelqu-un-d-autre',
      step: 'ready',
      mode: 'works',
      works: [],
      ownDescription: null,
      themes: null,
      charter: null,
      bible: null,
      name: 'Ailleurs',
      accentHue: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await select(app, other).expect(404);
    await select(app, 'pas-un-uuid').expect(400);
    expect(store.users[0]!.currentUniverseId).toBeNull();
    await app.close();
  });

  it('borne le nombre d histoires', async () => {
    for (let i = 0; i < STORIES_MAX; i += 1) await start(app).expect(201);
    await start(app).expect(409);
    expect(store.universes).toHaveLength(STORIES_MAX);
    await app.close();
  });

  it('recommencer n efface que l histoire ouverte', async () => {
    const first = (await start(app).expect(201)).body as Story;
    const second = (await start(app).expect(201)).body as Story;

    await request(app.getHttpServer()).delete('/onboarding').set('Cookie', COOKIE).expect(200);

    expect(store.universes.map((row) => row.id)).toEqual([first.id]);
    // Plus d'histoire ouverte : le parcours repart sur une histoire neuve.
    expect(store.users[0]!.currentUniverseId).toBeNull();
    const state = (
      await request(app.getHttpServer()).get('/onboarding').set('Cookie', COOKIE).expect(200)
    ).body as OnboardingState;
    expect(state.universeId).toBeNull();
    expect(state.step).toBe('inspiration');
    expect(second.id).not.toBe(first.id);
    await app.close();
  });

  it('supprime une histoire fermee sans toucher a l ouverte', async () => {
    const first = (await start(app).expect(201)).body as Story;
    const second = (await start(app).expect(201)).body as Story;

    const outcome = (await remove(app, first.id).expect(200)).body as DepartureOutcome;
    expect(outcome.world).toBe('deleted');

    expect(store.universes.map((row) => row.id)).toEqual([second.id]);
    expect(store.users[0]!.currentUniverseId).toBe(second.id);
    await app.close();
  });

  it('supprimer l histoire ouverte laisse le joueur sans histoire ouverte', async () => {
    const first = (await start(app).expect(201)).body as Story;
    const second = (await start(app).expect(201)).body as Story;

    await remove(app, second.id).expect(200);

    expect(store.universes.map((row) => row.id)).toEqual([first.id]);
    expect(store.users[0]!.currentUniverseId).toBeNull();
    await app.close();
  });

  it('refuse de supprimer une histoire en construction', async () => {
    const story = (await start(app).expect(201)).body as Story;
    store.universes[0]!.step = 'generating';

    await remove(app, story.id).expect(409);
    expect(store.universes).toHaveLength(1);
    await app.close();
  });

  it('ne supprime pas l histoire d un autre', async () => {
    const other = '01860000-0000-7000-8000-00000000dead';
    store.universes.push({
      id: other,
      ownerId: 'quelqu-un-d-autre',
      step: 'ready',
      mode: 'works',
      works: [],
      ownDescription: null,
      themes: null,
      charter: null,
      bible: null,
      name: 'Ailleurs',
      accentHue: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await remove(app, other).expect(404);
    expect(store.universes).toHaveLength(1);
    await app.close();
  });

  it('supprimer le compte emporte toutes les histoires', async () => {
    await start(app).expect(201);
    await start(app).expect(201);

    await request(app.getHttpServer()).delete('/me').set('Cookie', COOKIE).expect(200);
    expect(store.universes).toHaveLength(0);
    await app.close();
  });
});
