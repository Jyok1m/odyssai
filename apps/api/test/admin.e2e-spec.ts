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
import {
  adminUser,
  makeAdminPrisma,
  seededPlans,
  type AdminStore,
} from './../src/admin/testing/doubles.js';

const SESSION_ID = 'session-admin';
const COOKIE = `odyssai_session=${SESSION_ID}`;

interface Harness {
  app: INestApplication<App>;
  store: AdminStore;
}

async function boot(isAdmin: boolean): Promise<Harness> {
  const me = adminUser({
    username: 'Patron',
    email: 'patron@example.test',
    isAdmin,
  });
  const joueuse = adminUser({ username: 'Ael', email: 'ael@example.test' });

  const store: AdminStore = {
    users: [me, joueuse],
    plans: seededPlans(),
    subscriptions: [
      {
        id: 'sub-ael',
        userId: joueuse.id,
        plan: 'apprenti',
        status: 'active',
        credits: 120,
        // Une periode en cours, et non des dates figees : `ensure` roule une
        // periode expiree et remettrait la reserve a la dotation du palier,
        // ce qui ferait porter ces tests sur autre chose que l'ajustement.
        periodStart: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        periodEnd: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
        welcomed: true,
        stripeCustomerId: 'cus_ael',
        stripeSubscriptionId: 'sub_stripe_ael',
        cancelAtPeriodEnd: false,
      },
    ],
    entries: [],
  };

  const redis = new FakeRedis();
  await redis.set(
    `odyssai:session:${SESSION_ID}`,
    JSON.stringify({
      sub: me.keycloakId,
      userId: me.id,
      email: me.email,
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
    .useValue(makeAdminPrisma(store))
    .compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.use(cookieParser());
  await app.init();

  return { app, store };
}

let harness: Harness | null = null;

afterEach(async () => {
  await harness?.app.close();
  harness = null;
});

describe('Tableau de bord (e2e)', () => {
  /*
    Le test qui compte le plus. `AdminGuard` se pose apres `SessionGuard`, et
    l'inversion des deux ouvrirait tout a un anonyme sans qu'aucun type ne
    bronche. Chaque route est donc verifiee, pas seulement la premiere.
  */
  it.each([
    ['get', '/admin/overview'],
    ['get', '/admin/users'],
    ['get', '/admin/plans'],
    ['post', '/admin/plans'],
    ['get', '/admin/alpha'],
    ['patch', '/admin/alpha'],
    ['get', '/admin/contact'],
    ['get', '/admin/bugs'],
    ['patch', '/admin/bugs/00000000-0000-7000-8000-000000000000'],
    ['get', '/admin/bugs/00000000-0000-7000-8000-000000000000/screenshot'],
    ['get', '/admin/marketing/emails'],
  ])('refuse %s %s a un joueur ordinaire', async (method, path) => {
    harness = await boot(false);

    const response = await (request(harness.app.getHttpServer()) as any)
      [method](path)
      .set('Cookie', COOKIE)
      .send({});

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('forbidden');
  });

  it('refuse un anonyme avant meme de regarder le droit', async () => {
    harness = await boot(true);

    const response = await request(harness.app.getHttpServer()).get('/admin/overview');

    expect(response.status).toBe(401);
  });

  it('sert la liste des joueurs avec leur palier', async () => {
    harness = await boot(true);

    const response = await request(harness.app.getHttpServer())
      .get('/admin/users')
      .set('Cookie', COOKIE);

    expect(response.status).toBe(200);
    const ael = response.body.rows.find((row: { username: string }) => row.username === 'Ael');
    expect(ael.email).toBe('ael@example.test');
    expect(ael.plan).toBe('apprenti');
    expect(ael.planName).toBe('Apprenti');
    expect(ael.credits).toBe(120);
  });

  it('filtre sur le pseudo comme sur l adresse', async () => {
    harness = await boot(true);

    const response = await request(harness.app.getHttpServer())
      .get('/admin/users?search=ael@')
      .set('Cookie', COOKIE);

    expect(response.body.rows).toHaveLength(1);
    expect(response.body.rows[0].username).toBe('Ael');
  });

  /*
    Remettre a zero reste un mouvement : le grand livre est en ajout seul, et
    un solde qui tombe sans ecriture serait un trou inexplicable.
  */
  it('remet une reserve a zero en l ecrivant au grand livre', async () => {
    harness = await boot(true);
    const ael = harness.store.users.find((row) => row.username === 'Ael')!;

    const response = await request(harness.app.getHttpServer())
      .post(`/admin/users/${ael.id}/credits`)
      .set('Cookie', COOKIE)
      .send({ mode: 'set', credits: 0, note: 'abus constate' });

    expect(response.status).toBe(201);
    expect(response.body.credits).toBe(0);

    const entry = harness.store.entries.at(-1)!;
    expect(entry.delta).toBe(-120);
    expect(entry.reason).toBe('adjustment');
    expect(entry.balance).toBe(0);
    // Qui, et pourquoi.
    expect(entry.ref).toContain('abus constate');
  });

  it('ajoute des credits sans effacer ce qui restait', async () => {
    harness = await boot(true);
    const ael = harness.store.users.find((row) => row.username === 'Ael')!;

    const response = await request(harness.app.getHttpServer())
      .post(`/admin/users/${ael.id}/credits`)
      .set('Cookie', COOKIE)
      .send({ mode: 'add', credits: 50, note: 'geste commercial' });

    expect(response.body.credits).toBe(170);
  });

  // Dire pourquoi n'est pas facultatif : une reserve modifiee sans motif est
  // indefendable six mois plus tard.
  it('refuse un ajustement sans motif', async () => {
    harness = await boot(true);
    const ael = harness.store.users.find((row) => row.username === 'Ael')!;

    const response = await request(harness.app.getHttpServer())
      .post(`/admin/users/${ael.id}/credits`)
      .set('Cookie', COOKIE)
      .send({ mode: 'set', credits: 0 });

    expect(response.status).toBe(400);
    expect(harness.store.entries).toHaveLength(0);
  });

  it('ne descend jamais sous zero', async () => {
    harness = await boot(true);
    const ael = harness.store.users.find((row) => row.username === 'Ael')!;

    const response = await request(harness.app.getHttpServer())
      .post(`/admin/users/${ael.id}/credits`)
      .set('Cookie', COOKIE)
      .send({ mode: 'add', credits: -999, note: 'sanction' });

    expect(response.body.credits).toBe(0);
  });

  it('liste les paliers avec le nombre d abonnes', async () => {
    harness = await boot(true);

    const response = await request(harness.app.getHttpServer())
      .get('/admin/plans')
      .set('Cookie', COOKIE);

    const apprenti = response.body.find((row: { slug: string }) => row.slug === 'apprenti');
    expect(apprenti.subscriberCount).toBe(1);
    // Un palier que quelqu'un porte ne se supprime pas, il s'archive.
    expect(apprenti.removable).toBe(false);

    const free = response.body.find((row: { slug: string }) => row.slug === 'free');
    expect(free.removable).toBe(false);
  });

  // Tout y retombe : le supprimer laisserait des abonnements sans palier.
  it('protege le palier offert de la suppression', async () => {
    harness = await boot(true);

    const response = await request(harness.app.getHttpServer())
      .delete('/admin/plans/plan-free')
      .set('Cookie', COOKIE);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('plan_protected');
    expect(harness.store.plans).toHaveLength(2);
  });

  it('refuse de supprimer un palier que quelqu un porte', async () => {
    harness = await boot(true);

    const response = await request(harness.app.getHttpServer())
      .delete('/admin/plans/plan-apprenti')
      .set('Cookie', COOKIE);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('plan_in_use');
  });

  it('refuse un slug deja pris', async () => {
    harness = await boot(true);

    const response = await request(harness.app.getHttpServer())
      .post('/admin/plans')
      .set('Cookie', COOKIE)
      .send({ slug: 'apprenti', name: 'Doublon', monthlyCredits: 10 });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('slug_taken');
  });

  /*
    Sans montant, rien ne part chez Stripe : un palier offert se cree hors
    ligne, ce qui permet d'en ajouter un sans compte de paiement.
  */
  it('cree un palier offert sans rien demander a Stripe', async () => {
    harness = await boot(true);

    const response = await request(harness.app.getHttpServer())
      .post('/admin/plans')
      .set('Cookie', COOKIE)
      .send({ slug: 'invite', name: 'Invite', monthlyCredits: 10 });

    expect(response.status).toBe(201);
    expect(response.body.stripePriceId).toBeNull();
    expect(response.body.purchasable).toBeUndefined();
    expect(harness.store.plans).toHaveLength(3);
  });

  it('refuse un slug qui n en est pas un', async () => {
    harness = await boot(true);

    const response = await request(harness.app.getHttpServer())
      .post('/admin/plans')
      .set('Cookie', COOKIE)
      .send({ slug: 'Palier Majuscule', name: 'Non', monthlyCredits: 10 });

    expect(response.status).toBe(400);
  });

  it('modifie la dotation d un palier', async () => {
    harness = await boot(true);

    const response = await request(harness.app.getHttpServer())
      .patch('/admin/plans/plan-apprenti')
      .set('Cookie', COOKIE)
      .send({ monthlyCredits: 400 });

    expect(response.status).toBe(200);
    expect(response.body.monthlyCredits).toBe(400);
  });

  it('refuse d archiver le palier offert', async () => {
    harness = await boot(true);

    const response = await request(harness.app.getHttpServer())
      .patch('/admin/plans/plan-free')
      .set('Cookie', COOKIE)
      .send({ archived: true });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('plan_protected');
  });
});
