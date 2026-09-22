import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDIT_COSTS } from '@odyssai/engine';
import { PRISMA } from './../src/prisma/prisma.module.js';
import { REDIS } from './../src/redis/redis.module.js';
import { FakeRedis } from './../src/auth/testing/doubles.js';
import {
  PLAN_FIXTURES,
  makeOnboardingPrisma,
  type OnboardingStore,
} from './../src/onboarding/testing/doubles.js';

const APPRENTI = PLAN_FIXTURES.find((plan) => plan.slug === 'apprenti')!;

const SECRET = 'whsec_secret_e2e';

// Pose avant l'import d'AppModule par Nest : BillingConfig lit l'environnement
// a sa construction, donc au montage du module.
Object.assign(process.env, {
  STRIPE_PRIVATE_KEY: 'sk_test_factice',
  STRIPE_WEBHOOK_SECRET: SECRET,
  STRIPE_PRICE_APPRENTI: 'price_apprenti',
  STRIPE_PRICE_ARPENTEUR: 'price_arpenteur',
});

/*
  Le webhook Stripe de bout en bout.

  Ce qui est verifie ici et nulle part ailleurs : que le corps brut traverse
  la pile HTTP intact. `rawBody: true` manquant, la signature echoue pour
  tout le monde, et c'est le genre de panne qu'on met une soiree a
  comprendre.
*/
describe('Facturation (e2e)', () => {
  let app: INestApplication<App>;
  let store: OnboardingStore;

  const signed = (event: unknown) => {
    const payload = JSON.stringify(event);
    const stripe = new Stripe('sk_test_factice', { apiVersion: '2026-08-26.dahlia' });

    return {
      payload,
      signature: stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }),
    };
  };

  beforeAll(async () => {
    store = {
      users: [],
      universes: [],
      characters: [],
      messages: [],
      jobs: [],
      subscriptions: [
        {
          id: 'sub-local',
          userId: 'joueur',
          plan: 'apprenti',
          status: 'active',
          credits: 4,
          periodStart: new Date('2026-01-01T00:00:00Z'),
          periodEnd: new Date('2026-02-01T00:00:00Z'),
          welcomed: true,
          stripeCustomerId: 'cus_e2e',
          stripeSubscriptionId: 'sub_stripe',
          cancelAtPeriodEnd: false,
        },
      ],
      creditEntries: [],
    };

    const moduleFixture = await Test.createTestingModule({
      imports: [(await import('./../src/app.module.js')).AppModule],
    })
      .overrideProvider(REDIS)
      .useValue(new FakeRedis())
      .overrideProvider(PRISMA)
      .useValue(makeOnboardingPrisma(store))
      .compile();

    // La meme option que main.ts : sans elle, req.rawBody est absent.
    app = moduleFixture.createNestApplication<INestApplication<App>>({
      rawBody: true,
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('publie le catalogue sans demander de session', async () => {
    const response = await request(app.getHttpServer()).get('/billing/catalog');

    expect(response.status).toBe(200);
    expect(response.body.costs.turn).toBe(CREDIT_COSTS.turn);
    expect(response.body.costs.worldGeneration).toBe(CREDIT_COSTS.worldGeneration);
  });

  // Un plan sans prix chez Stripe n'existe pas : l'ecran doit le cacher.
  it('ne met en vente que les plans dont le prix est configure', async () => {
    const { body } = await request(app.getHttpServer()).get('/billing/catalog');
    const offers = Object.fromEntries(
      body.plans.map((plan: { id: string; purchasable: boolean }) => [
        plan.id,
        plan.purchasable,
      ]),
    );

    expect(offers.free).toBe(false);
    expect(offers.apprenti).toBe(true);
    expect(offers.arpenteur).toBe(true);
  });

  it('garde le solde derriere une session', async () => {
    const response = await request(app.getHttpServer()).get('/billing');

    expect(response.status).toBe(401);
  });

  it('garde la souscription derriere une session', async () => {
    const response = await request(app.getHttpServer())
      .post('/billing/checkout')
      .send({ plan: 'apprenti' });

    expect(response.status).toBe(401);
  });

  it('refuse un webhook sans signature', async () => {
    const response = await request(app.getHttpServer())
      .post('/billing/webhook')
      .set('content-type', 'application/json')
      .send({ id: 'evt_nu', type: 'invoice.paid' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('invalid_signature');
  });

  it('refuse un webhook signe avec un autre secret', async () => {
    const payload = JSON.stringify({ id: 'evt_x', type: 'invoice.paid' });
    const stripe = new Stripe('sk_test_factice', { apiVersion: '2026-08-26.dahlia' });

    const response = await request(app.getHttpServer())
      .post('/billing/webhook')
      .set('content-type', 'application/json')
      .set(
        'stripe-signature',
        stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_autre' }),
      )
      .send(payload);

    expect(response.status).toBe(400);
    expect(store.creditEntries).toHaveLength(0);
  });

  /*
    Le test qui compte : le corps brut arrive intact jusqu'au verificateur de
    signature, et le renouvellement credite la reserve.
  */
  it('credite la reserve sur une facture payee, une seule fois', async () => {
    const { payload, signature } = signed({
      id: 'evt_renouvellement',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_e2e',
          customer: 'cus_e2e',
          period_start: Math.floor(Date.parse('2026-03-20T09:00:00Z') / 1000),
        },
      },
    });

    const send = () =>
      request(app.getHttpServer())
        .post('/billing/webhook')
        .set('content-type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload);

    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);

    const subscription = store.subscriptions![0]!;
    expect(subscription.credits).toBe(APPRENTI.monthlyCredits);
    expect(subscription.periodEnd.toISOString()).toBe('2026-04-20T09:00:00.000Z');
    expect(store.creditEntries).toHaveLength(1);
  });
});
