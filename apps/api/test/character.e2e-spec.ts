import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  CharacterConversation,
  CharacterExtractResponse,
  CharacterStreamEvent,
} from '@odyssai/schemas';
import { AppModule } from './../src/app.module.js';
import { PRISMA } from './../src/prisma/prisma.module.js';
import { REDIS } from './../src/redis/redis.module.js';
import { NARRATOR_LLM } from './../src/onboarding/narrator-llm.provider.js';
import { GenerationQueueService } from './../src/onboarding/generation-queue.service.js';
import { FakeRedis } from './../src/auth/testing/doubles.js';
import { makeFakeLlm } from './../src/guide/testing/doubles.js';
import {
  makeOnboardingPrisma,
  makeUser,
  type OnboardingStore,
} from './../src/onboarding/testing/doubles.js';

const SESSION_ID = 'session-de-test';
const COOKIE = `odyssai_session=${SESSION_ID}`;

const SHEET = {
  name: 'Ael',
  gender: 'femme',
  age: 31,
  personality: { traits: ['tenace'], summary: 'Cartographe en fuite.' },
  attributes: { corps: 3, adresse: 4, esprit: 2, presence: 3, instinct: 4 },
};

interface Harness {
  app: INestApplication<App>;
  store: OnboardingStore;
}

async function boot(options: {
  step?: string;
  chunks?: string[];
  model?: string;
} = {}): Promise<Harness> {
  const user = makeUser({ username: 'Joueuse', usernameFolded: 'joueuse' });
  const universeId = '01860000-0000-7000-8000-000000000001';

  const store: OnboardingStore = {
    users: [user],
    universes: [
      {
        id: universeId,
        ownerId: user.id,
        step: options.step ?? 'character',
        mode: 'works',
        works: ['Dune'],
        ownDescription: null,
        themes: null,
        charter: null,
        bible: null,
        name: null,
        accentHue: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    characters: [],
    messages: [],
    jobs: [],
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
      accessToken: 'jeton-acces',
      refreshToken: 'jeton-refresh',
      idToken: 'jeton-id',
      accessExpiresAt: Date.now() + 3_600_000,
      refreshExpiresAt: Date.now() + 7_200_000,
    }),
    'EX',
    3600,
  );

  const previous = { ...process.env };
  process.env.LLM_NARRATOR_MODEL = options.model ?? 'modele/de-test';

  try {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS)
      .useValue(redis)
      .overrideProvider(PRISMA)
      .useValue(makeOnboardingPrisma(store))
      .overrideProvider(GenerationQueueService)
      .useValue({ enqueue: async () => {}, onApplicationShutdown: async () => {} })
      .overrideProvider(NARRATOR_LLM)
      .useValue(makeFakeLlm({ chunks: options.chunks ?? ['Bonjour. ', 'Quel age ?'] }))
      .compile();

    const app = moduleFixture.createNestApplication<INestApplication<App>>();
    app.use(cookieParser());
    await app.init();

    return { app, store };
  } finally {
    process.env = previous;
  }
}

function events(body: string): CharacterStreamEvent[] {
  return body
    .split('\n\n')
    .flatMap((block) => block.split('\n'))
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice('data:'.length).trim()) as CharacterStreamEvent);
}

function say(app: INestApplication<App>, content: string) {
  return request(app.getHttpServer())
    .post('/onboarding/character/messages')
    .set('Cookie', COOKIE)
    .send({ content });
}

describe('/onboarding/character (e2e)', () => {
  let app: INestApplication<App>;
  let store: OnboardingStore;

  beforeEach(async () => {
    ({ app, store } = await boot());
  });

  it('refuse un visiteur sans session', async () => {
    await request(app.getHttpServer()).get('/onboarding/character').expect(401);
  });

  // Le premier message n'existe pas en base : l'ecrire creerait une
  // conversation que l'extraction compterait pour rien.
  it('ouvre par un message qui n est pas enregistre', async () => {
    const body = (
      await request(app.getHttpServer())
        .get('/onboarding/character')
        .set('Cookie', COOKIE)
        .expect(200)
    ).body as CharacterConversation;

    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.role).toBe('assistant');
    expect(body.canExtract).toBe(false);
    expect(store.messages).toHaveLength(0);
  });

  it('diffuse la reponse et garde les deux messages', async () => {
    const response = await say(app, 'Elle s appelle Ael.').expect(200);
    const stream = events(response.text);

    expect(stream.filter((event) => event.type === 'delta')).toHaveLength(2);
    const done = stream.at(-1);
    expect(done?.type).toBe('done');
    if (done?.type !== 'done') return;
    expect(done.turnsLeft).toBe(11);
    expect(done.canExtract).toBe(false);

    expect(store.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(store.messages[1]!.content).toBe('Bonjour. Quel age ?');
  });

  it('reprend la conversation sauvegardee', async () => {
    await say(app, 'Elle s appelle Ael.').expect(200);

    const body = (
      await request(app.getHttpServer())
        .get('/onboarding/character')
        .set('Cookie', COOKIE)
        .expect(200)
    ).body as CharacterConversation;

    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]!.content).toBe('Elle s appelle Ael.');
  });

  it('refuse un message vide', async () => {
    await say(app, '   ').expect(400).expect({ code: 'validation_error' });
  });

  it('refuse la conversation hors de son etape', async () => {
    const ailleurs = await boot({ step: 'inspiration' });
    await request(ailleurs.app.getHttpServer())
      .get('/onboarding/character')
      .set('Cookie', COOKIE)
      .expect(409)
      .expect({ code: 'wrong_step' });

    await ailleurs.app.close();
  });

  it('ferme la conversation quand la generation est lancee', async () => {
    const lance = await boot({ step: 'generating' });
    await request(lance.app.getHttpServer())
      .get('/onboarding/character')
      .set('Cookie', COOKIE)
      .expect(409)
      .expect({ code: 'locked' });

    await lance.app.close();
  });

  it('refuse un treizieme tour', async () => {
    for (let index = 0; index < 12; index += 1) {
      await say(app, `message ${index}`).expect(200);
    }

    await say(app, 'un de trop')
      .expect(409)
      .expect({ code: 'conversation_over' });
  });

  // Le marqueur est un signal, pas du texte : ni diffuse, ni enregistre.
  it('demande la fiche sans montrer le marqueur', async () => {
    const harness = await boot({
      chunks: ['Je dresse ta fiche. ', '[[FI', 'CHE]]'],
    });

    let stream: CharacterStreamEvent[] = [];
    for (let index = 0; index < 3; index += 1) {
      stream = events((await say(harness.app, `message ${index}`).expect(200)).text);
    }

    const done = stream.at(-1);
    expect(done?.type).toBe('done');
    if (done?.type !== 'done') return;
    expect(done.sheet).toBe(true);

    const text = stream
      .filter((event) => event.type === 'delta')
      .map((event) => event.text)
      .join('');
    expect(text).toBe('Je dresse ta fiche. ');

    const last = harness.store.messages.at(-1);
    expect(last?.role).toBe('assistant');
    expect(last?.content).toBe('Je dresse ta fiche. ');

    await harness.app.close();
  });

  // Pose trop tot, il ferait appeler une extraction que l'api refuserait.
  it('ignore la demande de fiche tant que la conversation est trop courte', async () => {
    const harness = await boot({ chunks: ['Entendu. ', '[[FICHE]]'] });

    const stream = events((await say(harness.app, 'Vas-y.').expect(200)).text);
    const done = stream.at(-1);

    expect(done?.type).toBe('done');
    if (done?.type !== 'done') return;
    expect(done.canExtract).toBe(false);
    expect(done.sheet).toBe(false);

    await harness.app.close();
  });

  it('refuse d extraire une conversation trop courte', async () => {
    await say(app, 'Elle s appelle Ael.').expect(200);

    await request(app.getHttpServer())
      .post('/onboarding/character/extract')
      .set('Cookie', COOKIE)
      .expect(422)
      .expect({ code: 'too_short' });
  });

  it('propose une fiche sans rien enregistrer', async () => {
    const harness = await boot({ chunks: [JSON.stringify(SHEET)] });

    for (let index = 0; index < 3; index += 1) {
      await say(harness.app, `message ${index}`).expect(200);
    }

    const body = (
      await request(harness.app.getHttpServer())
        .post('/onboarding/character/extract')
        .set('Cookie', COOKIE)
        .expect(201)
    ).body as CharacterExtractResponse;

    expect(body.character.name).toBe('Ael');
    expect(body.missing).toEqual([]);
    // Le modele propose, le joueur corrige : rien n'est ecrit ici.
    expect(harness.store.characters).toHaveLength(0);

    await harness.app.close();
  });

  // Un age fantaisiste ne doit pas emporter le nom et la personnalite.
  it('garde les champs valides et signale les autres', async () => {
    const harness = await boot({
      chunks: [JSON.stringify({ ...SHEET, age: 9000, attributes: { corps: 99 } })],
    });

    for (let index = 0; index < 3; index += 1) {
      await say(harness.app, `message ${index}`).expect(200);
    }

    const body = (
      await request(harness.app.getHttpServer())
        .post('/onboarding/character/extract')
        .set('Cookie', COOKIE)
        .expect(201)
    ).body as CharacterExtractResponse;

    expect(body.character.name).toBe('Ael');
    expect(body.character.age).toBeUndefined();
    expect(body.missing).toEqual(['age', 'attributes']);

    await harness.app.close();
  });

});
