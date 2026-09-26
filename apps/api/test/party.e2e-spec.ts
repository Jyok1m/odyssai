import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PARTY_MAX,
  type OnboardingState,
  type Party,
  type TurnHistory,
} from '@odyssai/schemas';
import { AppModule } from './../src/app.module.js';
import { PRISMA } from './../src/prisma/prisma.module.js';
import { REDIS } from './../src/redis/redis.module.js';
import { NARRATOR_LLM } from './../src/onboarding/narrator-llm.provider.js';
import { GenerationQueueService } from './../src/onboarding/generation-queue.service.js';
import { GuideFakeRedis } from './../src/guide/testing/doubles.js';
import { makeFakeLlm } from './../src/guide/testing/doubles.js';
import {
  makeOnboardingPrisma,
  makeUser,
  type OnboardingStore,
  type PartyRow,
} from './../src/onboarding/testing/doubles.js';

const HOST_SESSION = 'session-de-l-hote';
const FRIEND_SESSION = 'session-de-l-ami';
const LATE_SESSION = 'session-du-retardataire';
const HOST_COOKIE = `odyssai_session=${HOST_SESSION}`;
const FRIEND_COOKIE = `odyssai_session=${FRIEND_SESSION}`;
const LATE_COOKIE = `odyssai_session=${LATE_SESSION}`;

const WORKS = { mode: 'works' as const, works: ['Dune'] };

const SHEET = {
  name: 'Ael',
  gender: 'femme',
  age: 31,
  personality: { traits: ['tenace'], summary: 'Cartographe en fuite.' },
  attributes: { corps: 3, adresse: 4, esprit: 2, presence: 3, instinct: 4 },
};

const FRIEND_SHEET = {
  ...SHEET,
  name: 'Bren',
  personality: { traits: ['rude'], summary: 'Garde de nuit, endetté.' },
};

const CHARTER = {
  premise: 'Un desert que l on traverse en achetant son eau a chaque etape.',
  tone: 'Sec, patient, sans merveilleux.',
  allowed: ['lire le vent', 'sceller un pacte par le sel'],
  forbidden: ['aucune arme a feu', 'aucune resurrection'],
  narratorRules: ['nommer la soif avant la peur', 'ne jamais promettre la pluie'],
};

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
      secret: 'il a lui meme ouvert le passage',
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

interface Harness {
  app: INestApplication<App>;
  store: OnboardingStore;
  redis: GuideFakeRedis;
  enqueued: string[];
}

async function boot(): Promise<Harness> {
  const host = makeUser({
    username: 'Hote',
    usernameFolded: 'hote',
  });
  const friend = makeUser({
    keycloakId: 'sujet-de-l-ami',
    username: 'Ami',
    usernameFolded: 'ami',
    email: 'ami@example.test',
  });
  const late = makeUser({
    keycloakId: 'sujet-du-retardataire',
    username: 'Retard',
    usernameFolded: 'retard',
    email: 'retard@example.test',
  });

  const store: OnboardingStore = {
    users: [host, friend, late],
    universes: [],
    characters: [],
    messages: [],
    jobs: [],
  };

  const redis = new GuideFakeRedis();
  for (const [sessionId, user] of [
    [HOST_SESSION, host],
    [FRIEND_SESSION, friend],
    [LATE_SESSION, late],
  ] as const) {
    await redis.set(
      `odyssai:session:${sessionId}`,
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
  }

  const enqueued: string[] = [];

  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(PRISMA)
    .useValue(makeOnboardingPrisma(store))
    .overrideProvider(GenerationQueueService)
    .useValue({
      enqueue: async (id: string) => {
        enqueued.push(id);
      },
      onApplicationShutdown: async () => {},
    })
    .overrideProvider(NARRATOR_LLM)
    .useValue(
      makeFakeLlm({
        chunks: ['La porte cede. ', '[[CANON]] {"kind":"action"}'],
      }),
    )
    .compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.use(cookieParser());
  await app.init();

  return { app, store, redis, enqueued };
}

function onboarding(app: INestApplication<App>, cookie: string) {
  return request(app.getHttpServer()).get('/onboarding').set('Cookie', cookie);
}

function save(
  app: INestApplication<App>,
  cookie: string,
  body: Record<string, unknown>,
) {
  return request(app.getHttpServer())
    .put('/onboarding')
    .set('Cookie', cookie)
    .send(body);
}

/*
  Une table de deux, ouverte et prete a jouer : l'hote, l'ami, le monde
  genere, les fiches. C'est l'etat duquel partent les tests de tour et de
  depart.
*/
async function readyParty(): Promise<Harness> {
  const harness = await boot();
  const { app, store } = harness;

  const created = (
    (await request(app.getHttpServer()).post('/parties').set('Cookie', HOST_COOKIE).send({ size: 2 }).expect(201)).body as Party
  );
  const code = created.inviteCode;

  await request(app.getHttpServer())
    .post('/parties/join')
    .set('Cookie', FRIEND_COOKIE)
    .send({ code })
    .expect(201);

  for (const [cookie] of [
    [HOST_COOKIE],
    [FRIEND_COOKIE],
  ] as const) {
    await save(app, cookie, {
      step: 'inspiration',
      inspiration: WORKS,
      advance: true,
    }).expect(200);
  }

  for (const [cookie, sheet] of [
    [HOST_COOKIE, SHEET],
    [FRIEND_COOKIE, FRIEND_SHEET],
  ] as const) {
    await save(app, cookie, {
      step: 'character',
      character: sheet,
      advance: true,
    }).expect(200);
  }

  const universe = store.universes.find((row) => row.id === created.universeId)!;
  universe.step = 'ready';
  universe.charter = CHARTER;
  universe.bible = BIBLE;
  universe.name = 'Sarek';
  universe.accentHue = 32;

  return harness;
}

/*
  Le parcours d'une table : ouvrir, rejoindre, remplir chacun sa part, et
  l'histoire qui n'avance que quand tout le monde y est.
*/
describe('/parties (e2e)', () => {
  let app: INestApplication<App>;
  let store: OnboardingStore;
  let enqueued: string[];

  beforeEach(async () => {
    ({ app, store, enqueued } = await boot());
  });

  it('refuse un visiteur sans session', async () => {
    await request(app.getHttpServer()).post('/parties').send({ size: 2 }).expect(401);
    await app.close();
  });

  it('refuse une taille hors bornes', async () => {
    await request(app.getHttpServer())
      .post('/parties')
      .set('Cookie', HOST_COOKIE)
      .send({ size: 1 })
      .expect(400)
      .expect({ code: 'validation_error' });

    await request(app.getHttpServer())
      .post('/parties')
      .set('Cookie', HOST_COOKIE)
      .send({ size: PARTY_MAX + 1 })
      .expect(400);
    await app.close();
  });

  it('ouvre une table et la sert dans le parcours', async () => {
    const party = (
      (await request(app.getHttpServer()).post('/parties').set('Cookie', HOST_COOKIE).send({ size: 3 }).expect(201)).body as Party
    );

    expect(party.size).toBe(3);
    expect(party.inviteCode).toHaveLength(8);
    expect(party.members).toHaveLength(1);
    expect(party.members[0]!.host).toBe(true);
    expect(party.members[0]!.mine).toBe(true);

    const state = (await onboarding(app, HOST_COOKIE).expect(200)).body as OnboardingState;
    expect(state.universeId).toBe(party.universeId);
    expect(state.party?.inviteCode).toBe(party.inviteCode);
    expect(state.step).toBe('inspiration');
    await app.close();
  });

  it('refuse une seconde table a qui en a deja une', async () => {
    await request(app.getHttpServer()).post('/parties').set('Cookie', HOST_COOKIE).send({ size: 2 }).expect(201);

    await request(app.getHttpServer())
      .post('/parties')
      .set('Cookie', HOST_COOKIE)
      .send({ size: 2 })
      .expect(409)
      .expect({ code: 'in_party' });
    await app.close();
  });

  it('rejoint par le code, et le code inconnu ne dit rien', async () => {
    const party = (
      (await request(app.getHttpServer()).post('/parties').set('Cookie', HOST_COOKIE).send({ size: 2 }).expect(201)).body as Party
    );

    // Un code qui ne correspond a rien ne dit pas s'il existe.
    await request(app.getHttpServer())
      .post('/parties/join')
      .set('Cookie', FRIEND_COOKIE)
      .send({ code: 'CCCCCCCC' })
      .expect(404)
      .expect({ code: 'not_found' });

    // Le code se plie : casses et separateurs importent peu.
    const joined = (
      (await request(app.getHttpServer())
        .post('/parties/join')
        .set('Cookie', FRIEND_COOKIE)
        .send({ code: `${party.inviteCode.slice(0, 4)}-${party.inviteCode.slice(4)}`.toLowerCase() })
        .expect(201)).body as Party
    );
    expect(joined.members).toHaveLength(2);

    // L'histoire ouverte de l'ami est celle de la table.
    const state = (await onboarding(app, FRIEND_COOKIE).expect(200)).body as OnboardingState;
    expect(state.universeId).toBe(party.universeId);
    await app.close();
  });

  it('remplit la table jusqu a la taille choisie, pas au-dela', async () => {
    const party = (
      (await request(app.getHttpServer()).post('/parties').set('Cookie', HOST_COOKIE).send({ size: 2 }).expect(201)).body as Party
    );
    await request(app.getHttpServer())
      .post('/parties/join')
      .set('Cookie', FRIEND_COOKIE)
      .send({ code: party.inviteCode })
      .expect(201);

    // La table est pleine : le troisieme siege n'existe pas.
    await request(app.getHttpServer())
      .post('/parties/join')
      .set('Cookie', LATE_COOKIE)
      .send({ code: party.inviteCode })
      .expect(409)
      .expect({ code: 'party_full' });

    // Et qui y siege deja n'y revient pas.
    await request(app.getHttpServer())
      .post('/parties/join')
      .set('Cookie', HOST_COOKIE)
      .send({ code: party.inviteCode })
      .expect(409)
      .expect({ code: 'in_party' });
    await app.close();
  });

  it('l etape n avance que quand tous les sieges ont cite leurs oeuvres', async () => {
    const party = (
      (await request(app.getHttpServer()).post('/parties').set('Cookie', HOST_COOKIE).send({ size: 2 }).expect(201)).body as Party
    );
    await request(app.getHttpServer())
      .post('/parties/join')
      .set('Cookie', FRIEND_COOKIE)
      .send({ code: party.inviteCode })
      .expect(201);

    // L'hote avance : sa saisie est complete, l'etape ne bouge pas.
    await save(app, HOST_COOKIE, {
      step: 'inspiration',
      inspiration: WORKS,
      advance: true,
    }).expect(200);

    let state = (await onboarding(app, HOST_COOKIE).expect(200)).body as OnboardingState;
    expect(state.step).toBe('inspiration');
    expect(state.party?.members.map((member) => member.ready)).toEqual([false, false]);

    // L'ami avance a son tour : l'etape du groupe avance.
    await save(app, FRIEND_COOKIE, {
      step: 'inspiration',
      inspiration: { mode: 'works', works: ['Fondation'] },
      advance: true,
    }).expect(200);

    state = (await onboarding(app, FRIEND_COOKIE).expect(200)).body as OnboardingState;
    expect(state.step).toBe('character');
    // L'inspiration de chacun se relit dans la sienne.
    expect(state.inspiration).toEqual({ mode: 'works', works: ['Fondation'] });
    await app.close();
  });

  it('refuse la description libre dans une table', async () => {
    const party = (
      (await request(app.getHttpServer()).post('/parties').set('Cookie', HOST_COOKIE).send({ size: 2 }).expect(201)).body as Party
    );

    await save(app, HOST_COOKIE, {
      step: 'inspiration',
      inspiration: { mode: 'own', ownDescription: 'un long texte decrivant un monde' },
      advance: false,
    })
      .expect(409)
      .expect({ code: 'wrong_step' });

    // Rien n'a ete ecrit : le sieges n'a pas d'oeuvres.
    expect(store.partyMembers?.find((row) => row.partyId === party.id)?.works).toEqual([]);
    await app.close();
  });

  it('ne lance qu une generation, et seulement quand la table est pleine et prete', async () => {
    const party = (
      (await request(app.getHttpServer()).post('/parties').set('Cookie', HOST_COOKIE).send({ size: 2 }).expect(201)).body as Party
    );
    await request(app.getHttpServer())
      .post('/parties/join')
      .set('Cookie', FRIEND_COOKIE)
      .send({ code: party.inviteCode })
      .expect(201);

    for (const cookie of [HOST_COOKIE, FRIEND_COOKIE]) {
      await save(app, cookie, {
        step: 'inspiration',
        inspiration: WORKS,
        advance: true,
      }).expect(200);
    }

    // Le premier pret ne lance rien : l'autre siege n'y est pas.
    await save(app, HOST_COOKIE, {
      step: 'character',
      character: SHEET,
      advance: true,
    }).expect(200);

    expect(enqueued).toEqual([]);
    let state = (await onboarding(app, HOST_COOKIE).expect(200)).body as OnboardingState;
    expect(state.step).toBe('character');
    expect(state.party?.members.find((member) => member.mine)?.ready).toBe(true);

    // Le dernier pret lance l'unique generation.
    await save(app, FRIEND_COOKIE, {
      step: 'character',
      character: FRIEND_SHEET,
      advance: true,
    }).expect(200);

    expect(enqueued).toEqual([party.universeId]);
    state = (await onboarding(app, FRIEND_COOKIE).expect(200)).body as OnboardingState;
    expect(state.step).toBe('generating');
    expect(store.jobs).toHaveLength(1);
    await app.close();
  });

  it('chaque siege paie sa part, et sa fiche est la sienne', async () => {
    const party = (
      (await request(app.getHttpServer()).post('/parties').set('Cookie', HOST_COOKIE).send({ size: 2 }).expect(201)).body as Party
    );
    await request(app.getHttpServer())
      .post('/parties/join')
      .set('Cookie', FRIEND_COOKIE)
      .send({ code: party.inviteCode })
      .expect(201);

    for (const cookie of [HOST_COOKIE, FRIEND_COOKIE]) {
      await save(app, cookie, {
        step: 'inspiration',
        inspiration: WORKS,
        advance: true,
      }).expect(200);
    }

    await save(app, HOST_COOKIE, {
      step: 'character',
      character: SHEET,
      advance: true,
    }).expect(200);

    // Deux sieges : la part vaut la moitie du monde, arrondie au dessus.
    const shares = store.creditEntries?.filter((row) => row.reason === 'worldGeneration') ?? [];
    expect(shares).toHaveLength(1);
    expect(shares[0]!.delta).toBe(-13);

    // Chacun sa fiche : deux lignes, un par joueur, dans le meme univers.
    expect(store.characters).toHaveLength(1);
    await save(app, FRIEND_COOKIE, {
      step: 'character',
      character: FRIEND_SHEET,
      advance: true,
    }).expect(200);
    expect(store.characters).toHaveLength(2);
    expect(new Set(store.characters.map((row) => row.ownerId)).size).toBe(2);
    expect(store.characters.every((row) => row.universeId === party.universeId)).toBe(true);
    await app.close();
  });

  /*
    Partir avant que le monde existe rend sa part : rien n'a ete genere pour
    lui. La part rendue est la sienne, jamais celle d'un autre siege.
  */
  it('rend sa part a qui partit avant la generation', async () => {
    const party = (
      (await request(app.getHttpServer()).post('/parties').set('Cookie', HOST_COOKIE).send({ size: 2 }).expect(201)).body as Party
    );
    await request(app.getHttpServer())
      .post('/parties/join')
      .set('Cookie', FRIEND_COOKIE)
      .send({ code: party.inviteCode })
      .expect(201);

    for (const cookie of [HOST_COOKIE, FRIEND_COOKIE]) {
      await save(app, cookie, {
        step: 'inspiration',
        inspiration: WORKS,
        advance: true,
      }).expect(200);
    }
    // L'hote valide sa fiche : sa part est debitee.
    await save(app, HOST_COOKIE, {
      step: 'character',
      character: SHEET,
      advance: true,
    }).expect(200);

    const hostId = store.users[0]!.id;
    const before = (store.creditEntries ?? []).filter(
      (row) => row.reason === 'worldGeneration',
    );
    expect(before).toHaveLength(1);

    // L'hote part avant que la table soit complete : sa part lui revient.
    const outcome = (
      await request(app.getHttpServer())
        .delete('/parties/me')
        .set('Cookie', HOST_COOKIE)
        .expect(200)
    ).body as { world: string; character: string };

    expect(outcome).toEqual({ world: 'kept', character: 'remembered' });
    const after = (store.creditEntries ?? []).filter(
      (row) => row.reason === 'refund',
    );
    expect(after).toHaveLength(1);
    expect(after[0]!.delta).toBe(13);
    expect(store.partyMembers?.some((row) => row.userId === hostId)).toBe(false);
    await app.close();
  });

  it('refuse de rejoindre une table partie', async () => {
    const party = (
      (await request(app.getHttpServer()).post('/parties').set('Cookie', HOST_COOKIE).send({ size: 2 }).expect(201)).body as Party
    );
    await save(app, HOST_COOKIE, {
      step: 'inspiration',
      inspiration: WORKS,
      advance: true,
    }).expect(200);
    store.universes[0]!.step = 'character';

    await request(app.getHttpServer())
      .post('/parties/join')
      .set('Cookie', FRIEND_COOKIE)
      .send({ code: party.inviteCode })
      .expect(409)
      .expect({ code: 'locked' });
    await app.close();
  });

  it('refuse de quitter pendant la generation', async () => {
    await request(app.getHttpServer()).post('/parties').set('Cookie', HOST_COOKIE).send({ size: 2 }).expect(201);
    store.universes[0]!.step = 'generating';

    await request(app.getHttpServer())
      .delete('/parties/me')
      .set('Cookie', HOST_COOKIE)
      .expect(409)
      .expect({ code: 'locked' });
    await app.close();
  });

  it('quitter laisse le monde a la table et le personnage au groupe', async () => {
    const harness = await readyParty();
    const { app, store } = harness;
    const universeId = store.universes[0]!.id;
    const partyId = (store.parties as PartyRow[])[0]!.id;
    const friendId = store.users[1]!.id;

    const outcome = (
      await request(app.getHttpServer())
        .delete('/parties/me')
        .set('Cookie', FRIEND_COOKIE)
        .expect(200)
    ).body as { world: string; character: string };

    expect(outcome).toEqual({ world: 'kept', character: 'remembered' });
    // Son siege part, son personnage prend sa tombe.
    expect(store.partyMembers?.some((row) => row.userId === friendId)).toBe(false);
    const kept = store.characters.find((row) => row.ownerId === friendId);
    expect(kept?.diedAt).not.toBeNull();
    expect(store.universes.map((row) => row.id)).toEqual([universeId]);
    // L'hote heberge toujours le monde.
    expect(store.universes[0]!.ownerId).toBe(store.users[0]!.id);
    expect((store.parties as PartyRow[])[0]!.id).toBe(partyId);

    // L'ami n'a plus d'histoire ouverte.
    const state = (await onboarding(app, FRIEND_COOKIE).expect(200)).body as OnboardingState;
    expect(state.universeId).toBeNull();
    expect(state.step).toBe('inspiration');
    await app.close();
    await harness.app.close();
  });

  it('l hote qui part laisse la table au membre le plus ancien', async () => {
    const harness = await readyParty();
    const { app, store } = harness;
    const universeId = store.universes[0]!.id;
    const friendId = store.users[1]!.id;

    const outcome = (
      await request(app.getHttpServer())
        .delete('/parties/me')
        .set('Cookie', HOST_COOKIE)
        .expect(200)
    ).body as { world: string; character: string };

    expect(outcome).toEqual({ world: 'kept', character: 'remembered' });
    expect(store.universes[0]!.ownerId).toBe(friendId);
    // La table survit, et l'ami y joue toujours.
    const state = (await onboarding(app, FRIEND_COOKIE).expect(200)).body as OnboardingState;
    expect(state.universeId).toBe(universeId);
    await app.close();
    await harness.app.close();
  });

  it('le dernier sortant emporte le monde', async () => {
    const harness = await readyParty();
    const { app, store } = harness;

    await request(app.getHttpServer())
      .delete('/parties/me')
      .set('Cookie', FRIEND_COOKIE)
      .expect(200);

    const outcome = (
      await request(app.getHttpServer())
        .delete('/parties/me')
        .set('Cookie', HOST_COOKIE)
        .expect(200)
    ).body as { world: string; character: string };

    expect(outcome).toEqual({ world: 'deleted', character: 'deleted' });
    expect(store.universes).toHaveLength(0);
    expect(store.parties).toHaveLength(0);
    await app.close();
    await harness.app.close();
  });
});

/*
  Le tour d'une table : le journal est partage, chacun voit ce que les
  autres ont dit, le meneur ne raconte qu'une scene a la fois, et le
  personnage qui joue est celui du joueur qui parle.
*/
describe('le tour d une table (e2e)', () => {
  let app: INestApplication<App>;
  let store: OnboardingStore;
  let redis: GuideFakeRedis;

  beforeEach(async () => {
    ({ app, store, redis } = await readyParty());
  });

  function play(cookie: string, content: string) {
    return request(app.getHttpServer())
      .post('/turn')
      .set('Cookie', cookie)
      .send({ kind: 'say', content });
  }

  it('joue un tour et le journal est partage, signe par son auteur', async () => {
    const stream = (await play(HOST_COOKIE, 'Je force la porte du depot.').expect(200)).text;
    expect(stream).toContain('data:');

    // Les deux messages du tour, l'auteur sur celui du joueur.
    const roles = store.messages
      .filter((row) => row.channel === 'game_turn')
      .map((row) => ({ role: row.role, memberId: row.memberId }));
    expect(roles).toEqual([
      { role: 'user', memberId: store.users[0]!.id },
      { role: 'assistant', memberId: null },
    ]);

    const history = (await request(app.getHttpServer())
      .get('/turn')
      .set('Cookie', FRIEND_COOKIE)
      .expect(200)).body as TurnHistory;

    expect(history.messages).toHaveLength(2);
    expect(history.messages[0]!.author).toBe('Ael');
    // L'ami voit le meme journal, le recit compris.
    expect(history.messages[1]!.content).toBe('La porte cede. ');
    await app.close();
  });

  it('refuse un second tour pendant que le meneur raconte', async () => {
    // Le creneau est pris : ni par l'ami, ni par l'hote lui-meme.
    await redis.set('turn:lock:' + store.universes[0]!.id, 'un-jeton', 'EX', 180);

    await play(HOST_COOKIE, 'Je force la porte.').expect(409).expect({ code: 'busy' });
    await play(FRIEND_COOKIE, 'Moi aussi je pousse.').expect(409).expect({ code: 'busy' });

    // Rien n'a ete ecrit : un tour refuse ne laisse rien.
    expect(store.messages.filter((row) => row.channel === 'game_turn')).toHaveLength(0);
    await app.close();
  });

  it('ouvre la partie une seule fois, pour la table entiere', async () => {
    const open = (cookie: string) =>
      request(app.getHttpServer())
        .post('/turn')
        .set('Cookie', cookie)
        .send({ kind: 'open' });

    const first = (await open(HOST_COOKIE).expect(200)).text;
    expect(first).toContain('La porte cede');

    // La scene existe : personne ne peut la rejouer, meme pas l'autre siege.
    await open(FRIEND_COOKIE).expect(409).expect({ code: 'already_started' });
    await app.close();
  });

  it('le monde se lit des deux cotes, et porte la table', async () => {
    const world = (
      (await request(app.getHttpServer())
        .get('/world')
        .set('Cookie', FRIEND_COOKIE)
        .expect(200)).body as { party: Party; character: { name: string } }
    );

    expect(world.party?.members).toHaveLength(2);
    expect(world.character.name).toBe('Bren');
    await app.close();
  });
});
