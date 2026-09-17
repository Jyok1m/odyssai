import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { OnboardingState } from '@odyssai/schemas';
import { AppModule } from './../src/app.module.js';
import { PRISMA } from './../src/prisma/prisma.module.js';
import { REDIS } from './../src/redis/redis.module.js';
import { FakeRedis } from './../src/auth/testing/doubles.js';
import {
  makeOnboardingPrisma,
  makeUser,
  type OnboardingStore,
} from './../src/onboarding/testing/doubles.js';

const SESSION_ID = 'session-de-test';
const COOKIE = `odyssai_session=${SESSION_ID}`;

/** Description valide : le schema strict en exige deux cents caracteres. */
const LONG_DESCRIPTION = 'Un archipel de cites flottantes. '.repeat(10);

const SHEET = {
  name: 'Ael',
  gender: 'femme',
  age: 31,
  personality: { traits: ['tenace', 'curieuse'], summary: 'Cartographe en fuite.' },
  attributes: { courage: 4, ruse: 3 },
};

interface Harness {
  app: INestApplication<App>;
  store: OnboardingStore;
}

async function boot(username: string | null = 'Joueuse'): Promise<Harness> {
  const store: OnboardingStore = {
    users: [makeUser({ username, usernameFolded: username?.toLowerCase() ?? null })],
    universes: [],
    characters: [],
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
    .compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.use(cookieParser());
  await app.init();

  return { app, store };
}

function get(app: INestApplication<App>) {
  return request(app.getHttpServer()).get('/onboarding').set('Cookie', COOKIE);
}

function put(app: INestApplication<App>, body: unknown) {
  return request(app.getHttpServer())
    .put('/onboarding')
    .set('Cookie', COOKIE)
    .send(body as object);
}

describe('/onboarding (e2e)', () => {
  let app: INestApplication<App>;
  let store: OnboardingStore;

  beforeEach(async () => {
    ({ app, store } = await boot());
  });

  it('refuse un visiteur sans session', async () => {
    await request(app.getHttpServer()).get('/onboarding').expect(401);
  });

  it('ne cree aucune ligne a la lecture', async () => {
    const response = await get(app).expect(200);
    const state = response.body as OnboardingState;

    expect(state).toMatchObject({
      universeId: null,
      step: 'inspiration',
      username: 'Joueuse',
      inspiration: null,
      character: null,
      generation: null,
    });
    expect(store.universes).toHaveLength(0);
  });

  it('renvoie l etape du pseudo tant qu il manque', async () => {
    const sansPseudo = await boot(null);
    const response = await get(sansPseudo.app).expect(200);

    expect((response.body as OnboardingState).step).toBe('username');
    await sansPseudo.app.close();
  });

  it('refuse d ecrire avant que le pseudo soit pose', async () => {
    const sansPseudo = await boot(null);
    await put(sansPseudo.app, {
      step: 'inspiration',
      inspiration: { mode: 'works', works: ['Dune'] },
    })
      .expect(409)
      .expect({ code: 'wrong_step' });

    await sansPseudo.app.close();
  });

  // Le comportement que tout le reste sert : fermer l onglet ne perd rien.
  it('sauvegarde une saisie incomplete et la rend telle quelle', async () => {
    await put(app, {
      step: 'inspiration',
      inspiration: { mode: 'own', ownDescription: 'trois mots' },
    }).expect(200);

    const state = (await get(app).expect(200)).body as OnboardingState;
    expect(state.inspiration).toEqual({ mode: 'own', ownDescription: 'trois mots' });
    expect(state.step).toBe('inspiration');
    expect(state.universeId).not.toBeNull();
  });

  it('ecrit la saisie puis refuse d avancer quand elle ne suffit pas', async () => {
    await put(app, {
      step: 'inspiration',
      inspiration: { mode: 'works', works: [] },
      advance: true,
    })
      .expect(422)
      .expect({ code: 'incomplete' });

    const state = (await get(app).expect(200)).body as OnboardingState;
    expect(state.step).toBe('inspiration');
    expect(state.inspiration).toEqual({ mode: 'works', works: [] });
  });

  it('avance quand la saisie est complete', async () => {
    const state = (
      await put(app, {
        step: 'inspiration',
        inspiration: { mode: 'works', works: ['Dune', 'Le Nom de la Rose'] },
        advance: true,
      }).expect(200)
    ).body as OnboardingState;

    expect(state.step).toBe('character');
    expect(state.inspiration).toEqual({
      mode: 'works',
      works: ['Dune', 'Le Nom de la Rose'],
    });
  });

  it('refuse deux fois la meme oeuvre', async () => {
    await put(app, {
      step: 'inspiration',
      inspiration: { mode: 'works', works: ['Dune', 'dune'] },
    })
      .expect(400)
      .expect({ code: 'validation_error' });
  });

  it('refuse une charge utile de la mauvaise etape', async () => {
    await put(app, {
      step: 'character',
      inspiration: { mode: 'works', works: ['Dune'] },
    })
      .expect(400)
      .expect({ code: 'validation_error' });
  });

  it('refuse d ecrire une etape non ouverte', async () => {
    await put(app, { step: 'character', character: { name: 'Ael' } })
      .expect(409)
      .expect({ code: 'wrong_step' });
  });

  it('efface les themes des qu une inspiration change', async () => {
    await put(app, {
      step: 'inspiration',
      inspiration: { mode: 'own', ownDescription: LONG_DESCRIPTION },
      advance: true,
    }).expect(200);

    store.universes[0]!.themes = { climat: 'aride' };

    await put(app, {
      step: 'inspiration',
      inspiration: { mode: 'own', ownDescription: `${LONG_DESCRIPTION} Et des vents.` },
    }).expect(200);

    expect(store.universes[0]!.themes).toBeNull();
  });

  it('retient une fiche de personnage a moitie remplie', async () => {
    await put(app, {
      step: 'inspiration',
      inspiration: { mode: 'own', ownDescription: LONG_DESCRIPTION },
      advance: true,
    }).expect(200);

    await put(app, { step: 'character', character: { name: 'Ael' } }).expect(200);

    const state = (await get(app).expect(200)).body as OnboardingState;
    expect(state.step).toBe('character');
    expect(state.character).toEqual({ name: 'Ael' });
  });

  it('ouvre la generation quand la fiche est complete, puis se ferme', async () => {
    await put(app, {
      step: 'inspiration',
      inspiration: { mode: 'own', ownDescription: LONG_DESCRIPTION },
      advance: true,
    }).expect(200);

    const state = (
      await put(app, { step: 'character', character: SHEET, advance: true }).expect(200)
    ).body as OnboardingState;

    expect(state.step).toBe('generating');
    expect(state.generation).toEqual({ status: 'queued', step: null, error: null });
    expect(store.jobs).toHaveLength(1);

    // Une generation lancee ferme le parcours : plus rien ne s ecrit.
    await put(app, { step: 'character', character: { name: 'Autre' } })
      .expect(409)
      .expect({ code: 'locked' });
  });

  it('laisse revenir en arriere tant que la generation n est pas lancee', async () => {
    await put(app, {
      step: 'inspiration',
      inspiration: { mode: 'works', works: ['Dune'] },
      advance: true,
    }).expect(200);

    const state = (
      await put(app, {
        step: 'inspiration',
        inspiration: { mode: 'works', works: ['Dune', 'Le Nom de la Rose'] },
      }).expect(200)
    ).body as OnboardingState;

    // Une correction ne doit pas faire perdre la place acquise.
    expect(state.step).toBe('character');
    expect(state.inspiration).toEqual({
      mode: 'works',
      works: ['Dune', 'Le Nom de la Rose'],
    });
  });
});
