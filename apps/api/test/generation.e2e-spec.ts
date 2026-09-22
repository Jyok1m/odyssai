import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { describe, expect, it } from 'vitest';
import type { GenerationStreamEvent, WorldView } from '@odyssai/schemas';
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

const CHARTER = {
  premise: 'Un desert que l on traverse en achetant son eau a chaque etape.',
  tone: 'Sec, patient, sans merveilleux.',
  allowed: ['lire le vent', 'sceller un pacte par le sel'],
  forbidden: ['aucune arme a feu', 'aucune resurrection'],
  narratorRules: ['nommer la soif avant la peur', 'ne jamais promettre la pluie'],
};

const SECRET = 'il a lui meme ouvert le passage, il y a douze ans';

const BIBLE = {
  lore: {
    name: 'Sarek',
    era: 'la troisieme secheresse',
    geography: 'des plateaux de pierre coupes de canyons',
    history: 'un puits creve a noye la vallee basse',
    dailyLife: 'on marche, on paie son eau, on dort',
    accentHue: 32,
  },
  factions: [
    {
      name: 'Les Scelleurs',
      creed: 'l eau se merite',
      strength: 'ils tiennent les sceaux',
      territory: 'le nord',
      symbol: 'un anneau de sel',
    },
    {
      name: 'La Marche Basse',
      creed: 'ce que la terre rend est a qui marche',
      strength: 'des passages inconnus',
      territory: 'les canyons',
      symbol: 'une corde nouee',
    },
  ],
  politics: {
    balance: 'les uns vendent, les autres contournent',
    conflicts: ['une veine detournee'],
    stakes: 'si un puits cede, les deux perdent',
  },
  npcs: [
    {
      name: 'Ourden',
      role: 'sceleur',
      faction: 'Les Scelleurs',
      drive: 'reprendre la veine',
      secret: SECRET,
    },
    {
      name: 'Nise',
      role: 'guide',
      faction: 'La Marche Basse',
      drive: 'trouver qui a cartographie',
      secret: 'elle cherche Ael',
    },
    {
      name: 'Bardem',
      role: 'porteur',
      faction: null,
      drive: 'payer sa dette',
      secret: 'il revend l eau',
    },
  ],
  affinities: [
    {
      subject: 'Les Scelleurs',
      target: 'La Marche Basse',
      stance: 'rival',
      note: 'une veine disputee',
    },
    { subject: 'Nise', target: 'Ael', stance: 'dette', note: 'une carte rendue' },
    { subject: 'Ourden', target: 'Ael', stance: 'neutre', note: 'il ignore tout' },
  ],
};

interface Options {
  step: string;
  ready?: boolean;
  job?: { status: string; step: string | null; error: string | null };
}

async function boot(options: Options): Promise<INestApplication<App>> {
  const user = makeUser({
    username: 'Joueuse',
    usernameFolded: 'joueuse',
    currentUniverseId: UNIVERSE_ID,
  });

  const store: OnboardingStore = {
    users: [user],
    universes: [
      {
        id: UNIVERSE_ID,
        ownerId: user.id,
        step: options.step,
        mode: 'works',
        works: ['Dune'],
        ownDescription: null,
        themes: null,
        charter: options.ready ? CHARTER : null,
        bible: options.ready ? BIBLE : null,
        name: options.ready ? 'Sarek' : null,
        accentHue: options.ready ? 32 : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    characters: [
      {
        id: '01860000-0000-7000-8000-000000000002',
        universeId: UNIVERSE_ID,
        name: 'Ael',
        gender: 'femme',
        age: 31,
        personality: { traits: ['tenace'], summary: 'Cartographe en fuite.' },
        attributes: { corps: 3, adresse: 4, esprit: 2, presence: 3, instinct: 4 },
        diedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    messages: [],
    jobs: options.job
      ? [
          {
            id: '01860000-0000-7000-8000-000000000003',
            universeId: UNIVERSE_ID,
            status: options.job.status,
            step: options.job.step,
            attempts: 1,
            error: options.job.error,
            traceId: null,
            startedAt: new Date(),
            finishedAt: null,
            createdAt: new Date(),
          },
        ]
      : [],
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
  return app;
}

function events(body: string): GenerationStreamEvent[] {
  return body
    .split('\n\n')
    .flatMap((block) => block.split('\n'))
    .filter((line) => line.startsWith('data:'))
    .map(
      (line) => JSON.parse(line.slice('data:'.length).trim()) as GenerationStreamEvent,
    );
}

describe('/onboarding/generation et /world (e2e)', () => {
  it('refuse un visiteur sans session', async () => {
    const app = await boot({ step: 'generating' });
    await request(app.getHttpServer()).get('/world').expect(401);
    await app.close();
  });

  it('annonce le monde des qu il est pret', async () => {
    const app = await boot({ step: 'ready', ready: true });

    const stream = events(
      (
        await request(app.getHttpServer())
          .get('/onboarding/generation')
          .set('Cookie', COOKIE)
          .expect(200)
      ).text,
    );

    expect(stream).toEqual([{ type: 'ready', name: 'Sarek' }]);
    await app.close();
  });

  it('remonte l echec avec sa cause', async () => {
    const app = await boot({
      step: 'failed',
      job: { status: 'failed', step: 'lore', error: 'lore : sortie illisible' },
    });

    const stream = events(
      (
        await request(app.getHttpServer())
          .get('/onboarding/generation')
          .set('Cookie', COOKIE)
          .expect(200)
      ).text,
    );

    expect(stream).toEqual([
      { type: 'failed', error: 'lore : sortie illisible' },
    ]);
    await app.close();
  });

  it('dit ou en est la generation, puis se tait jusqu au prochain tour', async () => {
    const app = await boot({
      step: 'generating',
      job: { status: 'running', step: 'factions', error: null },
    });

    const server = app.getHttpServer() as unknown as Server;
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    // Le flux ne se ferme pas de lui-meme : on lit le premier evenement puis
    // on raccroche, comme le ferait un joueur qui quitte la page.
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/onboarding/generation`, {
      headers: { Cookie: COOKIE },
      signal: controller.signal,
    });

    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    controller.abort();

    expect(events(first)).toEqual([
      { type: 'progress', status: 'running', step: 'factions', attempts: 1 },
    ]);

    await app.close();
  });

  it('refuse le monde tant qu il n est pas genere', async () => {
    const app = await boot({ step: 'character' });

    await request(app.getHttpServer())
      .get('/world')
      .set('Cookie', COOKIE)
      .expect(404)
      .expect({ code: 'not_ready' });

    await app.close();
  });

  it('sert le monde genere', async () => {
    const app = await boot({ step: 'ready', ready: true });

    const world = (
      await request(app.getHttpServer())
        .get('/world')
        .set('Cookie', COOKIE)
        .expect(200)
    ).body as WorldView;

    expect(world.name).toBe('Sarek');
    expect(world.accentHue).toBe(32);
    expect(world.factions).toHaveLength(2);
    expect(world.character.name).toBe('Ael');
    await app.close();
  });

  /*
    Le secret d'un personnage se decouvre en jeu. Il est en base, il ne doit
    pas partir dans la reponse, et c'est le schema de vue qui le garantit.
  */
  it('ne laisse pas fuiter les secrets des personnages', async () => {
    const app = await boot({ step: 'ready', ready: true });

    const response = await request(app.getHttpServer())
      .get('/world')
      .set('Cookie', COOKIE)
      .expect(200);

    expect(response.text).not.toContain(SECRET);
    expect(response.text).not.toContain('secret');
    for (const npc of (response.body as WorldView).npcs) {
      expect(npc).not.toHaveProperty('secret');
    }

    await app.close();
  });
});
