import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { describe, expect, it } from 'vitest';
import type { AccountErasure, DepartureOutcome } from '@odyssai/schemas';
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
const UNIVERSE_ID = '01860000-0000-7000-8000-000000000001';
const CHARACTER_ID = '01860000-0000-7000-8000-000000000002';
/** Le monde d'accueil : le personnage y a voyage, le sien n'a recu personne. */
const HOST_UNIVERSE_ID = '01860000-0000-7000-8000-000000000003';

interface Harness {
  app: INestApplication<App>;
  store: OnboardingStore;
}

/** `visited` et `met` disent ce que d'autres joueurs ont deja vu. */
async function boot(
  options: { step?: string; visited?: boolean; met?: boolean } = {},
): Promise<Harness> {
  const user = makeUser({ username: 'Joueuse', usernameFolded: 'joueuse' });
  const stranger = makeUser({ keycloakId: 'autre-joueur' });

  const encounters = [];
  if (options.visited) {
    encounters.push({
      id: '01860000-0000-7000-8000-000000000010',
      visitorId: stranger.id,
      universeId: UNIVERSE_ID,
      characterId: null,
      createdAt: new Date(),
    });
  }
  if (options.met) {
    encounters.push({
      id: '01860000-0000-7000-8000-000000000011',
      visitorId: stranger.id,
      universeId: HOST_UNIVERSE_ID,
      characterId: CHARACTER_ID,
      createdAt: new Date(),
    });
  }

  const store: OnboardingStore = {
    users: [user, stranger],
    universes: [
      {
        id: UNIVERSE_ID,
        ownerId: user.id,
        step: options.step ?? 'ready',
        mode: 'works',
        works: ['Dune', 'Fondation'],
        ownDescription: 'un texte ecrit par la joueuse',
        themes: { tone: 'grave' },
        charter: null,
        bible: null,
        name: 'Sarek',
        accentHue: 32,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    characters: [
      {
        id: CHARACTER_ID,
        universeId: UNIVERSE_ID,
        name: 'Ael',
        gender: 'femme',
        age: 31,
        personality: { traits: ['tenace'], summary: 'x' },
        attributes: { courage: 4 },
        diedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    messages: [
      {
        id: '01860000-0000-7000-8000-000000000020',
        universeId: UNIVERSE_ID,
        channel: 'character_creation',
        role: 'user',
        content: 'Elle s appelle Ael.',
        seq: 0,
        createdAt: new Date(),
      },
    ],
    jobs: [],
    encounters,
  };

  const redis = new FakeRedis();
  await redis.set(
    `odyssai:session:${SESSION_ID}`,
    JSON.stringify({
      sub: user.keycloakId,
      userId: user.id,
      email: user.email,
      emailVerified: true,
      roles: [],
      accessToken: 'a',
      refreshToken: 'r',
      idToken: 'i',
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

describe('depart (e2e)', () => {
  it('refuse un visiteur sans session', async () => {
    const { app } = await boot();
    await request(app.getHttpServer()).delete('/onboarding').expect(401);
    await app.close();
  });

  // Personne n'est passe : rien ne justifie de garder quoi que ce soit.
  it('supprime tout quand personne n a rien vu', async () => {
    const { app, store } = await boot();

    const outcome = (
      await request(app.getHttpServer())
        .delete('/onboarding')
        .set('Cookie', COOKIE)
        .expect(200)
    ).body as DepartureOutcome;

    expect(outcome).toEqual({ world: 'deleted', character: 'deleted' });
    expect(store.universes).toHaveLength(0);
    expect(store.characters).toHaveLength(0);
    expect(store.messages).toHaveLength(0);
    await app.close();
  });

  /**
   * Le personnage a voyage, son monde non. Les deux questions sont
   * independantes : la tombe doit survivre a la suppression du monde.
   */
  it('garde un personnage rencontre, et le dit mort', async () => {
    const { app, store } = await boot({ met: true });

    const outcome = (
      await request(app.getHttpServer())
        .delete('/onboarding')
        .set('Cookie', COOKIE)
        .expect(200)
    ).body as DepartureOutcome;

    expect(outcome).toEqual({ world: 'deleted', character: 'remembered' });
    expect(store.universes).toHaveLength(0);
    expect(store.characters).toHaveLength(1);
    expect(store.characters[0]!.diedAt).not.toBeNull();
    // Detache par le SetNull, il n'est pas parti avec son monde.
    expect(store.characters[0]!.universeId).toBeNull();
    await app.close();
  });

  it('garde un monde visite, detache et vide des mots du joueur', async () => {
    const { app, store } = await boot({ visited: true });

    const outcome = (
      await request(app.getHttpServer())
        .delete('/onboarding')
        .set('Cookie', COOKIE)
        .expect(200)
    ).body as DepartureOutcome;

    expect(outcome).toEqual({ world: 'kept', character: 'deleted' });

    const universe = store.universes[0]!;
    expect(universe.ownerId).toBeNull();
    expect(universe.works).toEqual([]);
    expect(universe.ownDescription).toBeNull();
    // Ce que le modele a ecrit reste, ce que la joueuse a tape part.
    expect(universe.name).toBe('Sarek');
    expect(store.messages).toHaveLength(0);
    await app.close();
  });

  it('refuse de recommencer pendant la generation', async () => {
    const { app } = await boot({ step: 'generating' });

    await request(app.getHttpServer())
      .delete('/onboarding')
      .set('Cookie', COOKIE)
      .expect(409)
      .expect({ code: 'locked' });

    await app.close();
  });

  it('supprime le compte et rend l adresse de la console du realm', async () => {
    const { app, store } = await boot({ visited: true, met: true });

    const body = (
      await request(app.getHttpServer())
        .delete('/me')
        .set('Cookie', COOKIE)
        .expect(200)
    ).body as AccountErasure;

    expect(body.world).toBe('kept');
    expect(body.character).toBe('remembered');
    // L'identite appartient au realm : l'api ne fait que dire ou la supprimer.
    expect(body.accountUrl).toContain('/account');

    expect(store.users.map((user) => user.username)).not.toContain('Joueuse');
    expect(store.universes[0]!.ownerId).toBeNull();
    await app.close();
  });

  it('ferme la session du compte supprime', async () => {
    const { app } = await boot();

    await request(app.getHttpServer()).delete('/me').set('Cookie', COOKIE).expect(200);
    await request(app.getHttpServer()).get('/me').set('Cookie', COOKIE).expect(401);

    await app.close();
  });
});
