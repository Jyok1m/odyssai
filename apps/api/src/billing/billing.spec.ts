import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import type { PrismaClient } from '@odyssai/db';
import { planOf } from '@odyssai/engine';
import { AppConfig } from '../config/app-config.js';
import { BillingConfig } from '../config/billing-config.js';
import type { CreditsService } from '../credits/credits.service.js';
import { BillingService } from './billing.service.js';

const SECRET = 'whsec_secret_de_test';
const KEPT = { ...process.env };

/**
 * La ligne d'abonnement, telle qu'elle vit en base. Un double en memoire
 * suffit : ce qui est verifie ici est la lecture des evenements Stripe, pas
 * Prisma.
 */
interface Row {
  id: string;
  userId: string;
  plan: string;
  status: string;
  credits: number;
  periodStart: Date;
  periodEnd: Date;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
}

interface Entry {
  delta: number;
  reason: string;
  ref: string | null;
  balance: number;
}

function fakePrisma(row: Row) {
  const entries: Entry[] = [];
  const seen = new Set<string>();

  const db = {
    subscription: {
      // Rend une copie, comme Prisma : une ligne lue est un instantane, pas
      // une reference que l'ecriture suivante mettrait a jour toute seule.
      findUnique: async ({ where }: { where: Record<string, unknown> }) => {
        if ('stripeCustomerId' in where) {
          return where.stripeCustomerId === row.stripeCustomerId ? { ...row } : null;
        }
        if ('userId' in where) return where.userId === row.userId ? { ...row } : null;
        return where.id === row.id ? { ...row } : null;
      },
      update: async ({ data }: { data: Partial<Row> }) => {
        Object.assign(row, data);
        return { ...row };
      },
    },
    creditEntry: {
      create: async ({ data }: { data: Entry }) => {
        entries.push(data);
        return data;
      },
    },
    stripeEvent: {
      create: async ({ data }: { data: { id: string } }) => {
        // La contrainte de cle primaire, qui est tout le mecanisme
        // d'idempotence : Stripe rejoue jusqu'a obtenir un 2xx.
        if (seen.has(data.id)) throw new Error('doublon');
        seen.add(data.id);
        return data;
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };

  return { db: db as unknown as PrismaClient, entries, row };
}

function billing(prisma: PrismaClient) {
  process.env = {
    ...KEPT,
    ODYSSAI_ENV: 'development',
    STRIPE_PRIVATE_KEY: 'sk_test_factice',
    STRIPE_WEBHOOK_SECRET: SECRET,
    STRIPE_PRICE_APPRENTI: 'price_apprenti',
    STRIPE_PRICE_ARPENTEUR: 'price_arpenteur',
  };

  const credits = {} as CreditsService;
  return new BillingService(prisma, new BillingConfig(), {} as AppConfig, credits);
}

/** Signe comme Stripe signe : meme HMAC, sans le moindre appel reseau. */
function signed(event: unknown): { body: Buffer; signature: string } {
  const payload = JSON.stringify(event);
  const stripe = new Stripe('sk_test_factice', { apiVersion: '2026-08-26.dahlia' });

  return {
    body: Buffer.from(payload, 'utf8'),
    signature: stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }),
  };
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'sub-local',
    userId: 'joueur',
    plan: 'free',
    status: 'active',
    credits: 12,
    periodStart: new Date('2026-01-01T00:00:00Z'),
    periodEnd: new Date('2026-02-01T00:00:00Z'),
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

function subscriptionEvent(id: string, type: string, price: string, extra = {}) {
  return {
    id,
    type,
    data: {
      object: {
        id: 'sub_stripe',
        customer: 'cus_1',
        status: 'active',
        cancel_at_period_end: false,
        items: { data: [{ price: { id: price } }] },
        ...extra,
      },
    },
  };
}

afterEach(() => {
  process.env = { ...KEPT };
});

describe('webhook Stripe', () => {
  let fake: ReturnType<typeof fakePrisma>;
  let service: BillingService;

  beforeEach(() => {
    fake = fakePrisma(row());
    service = billing(fake.db);
  });

  it('refuse une signature qui ne vient pas de Stripe', async () => {
    const { body } = signed(subscriptionEvent('evt_1', 'customer.subscription.updated', 'price_apprenti'));

    await expect(service.handle(body, 't=1,v1=falsifiee')).rejects.toThrow();
    expect(fake.row.plan).toBe('free');
  });

  it('refuse un corps modifie apres signature', async () => {
    const { body, signature } = signed(
      subscriptionEvent('evt_1', 'customer.subscription.updated', 'price_apprenti'),
    );
    const altere = Buffer.from(body.toString('utf8').replace('price_apprenti', 'price_arpenteur'));

    await expect(service.handle(altere, signature)).rejects.toThrow();
  });

  it('porte le plan du prix vers la ligne du joueur', async () => {
    const { body, signature } = signed(
      subscriptionEvent('evt_1', 'customer.subscription.updated', 'price_arpenteur'),
    );

    await service.handle(body, signature);

    expect(fake.row.plan).toBe('arpenteur');
    expect(fake.row.stripeSubscriptionId).toBe('sub_stripe');
  });

  /**
   * Un prix qu'on ne connait pas ne doit rien changer : le prendre pour le
   * palier libre ferait retomber un abonne payant.
   */
  it('ignore un prix inconnu plutot que de deviner', async () => {
    const { body, signature } = signed(
      subscriptionEvent('evt_1', 'customer.subscription.updated', 'price_dun_autre_produit'),
    );

    await service.handle(body, signature);

    expect(fake.row.plan).toBe('free');
  });

  it('compte trialing comme actif', async () => {
    const { body, signature } = signed(
      subscriptionEvent('evt_1', 'customer.subscription.updated', 'price_apprenti', {
        status: 'trialing',
      }),
    );

    await service.handle(body, signature);

    expect(fake.row.status).toBe('active');
  });

  it('fait retomber au palier libre a la resiliation', async () => {
    fake = fakePrisma(row({ plan: 'arpenteur', stripeSubscriptionId: 'sub_stripe' }));
    service = billing(fake.db);

    const { body, signature } = signed(
      subscriptionEvent('evt_2', 'customer.subscription.deleted', 'price_arpenteur'),
    );

    await service.handle(body, signature);

    expect(fake.row.plan).toBe('free');
    expect(fake.row.status).toBe('canceled');
    expect(fake.row.stripeSubscriptionId).toBeNull();
  });

  it('ne coupe rien sur un paiement en echec', async () => {
    fake = fakePrisma(row({ plan: 'apprenti' }));
    service = billing(fake.db);

    const { body, signature } = signed({
      id: 'evt_3',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_1', customer: 'cus_1' } },
    });

    await service.handle(body, signature);

    // Stripe relance plusieurs jours : c'est subscription.deleted qui tranche.
    expect(fake.row.plan).toBe('apprenti');
    expect(fake.row.credits).toBe(12);
  });
});

describe('renouvellement', () => {
  const invoice = (id: string, periodStart: string) => ({
    id: `evt_${id}`,
    type: 'invoice.paid',
    data: {
      object: {
        id,
        customer: 'cus_1',
        period_start: Math.floor(new Date(periodStart).getTime() / 1000),
      },
    },
  });

  it('remet la reserve a la dotation du plan, sans la cumuler', async () => {
    const fake = fakePrisma(row({ plan: 'apprenti', credits: 12 }));
    const service = billing(fake.db);
    const { body, signature } = signed(invoice('in_1', '2026-03-20T09:00:00Z'));

    await service.handle(body, signature);

    expect(fake.row.credits).toBe(planOf('apprenti').monthly);
    expect(fake.entries).toHaveLength(1);
    expect(fake.entries[0]!.reason).toBe('grant');
    expect(fake.entries[0]!.ref).toBe('in_1');
    // Le solde est fige dans l'ecriture : relire le grand livre des annees
    // plus tard doit donner ce que le joueur a vu.
    expect(fake.entries[0]!.balance).toBe(planOf('apprenti').monthly);
    expect(fake.entries[0]!.delta).toBe(planOf('apprenti').monthly - 12);
  });

  /** Un abonne du 20 ne doit pas voir sa reserve repartir le 1er. */
  it('ancre la periode sur la facture, pas sur le calendrier', async () => {
    const fake = fakePrisma(row({ plan: 'apprenti' }));
    const service = billing(fake.db);
    const { body, signature } = signed(invoice('in_1', '2026-03-20T09:00:00Z'));

    await service.handle(body, signature);

    expect(fake.row.periodStart.toISOString()).toBe('2026-03-20T09:00:00.000Z');
    expect(fake.row.periodEnd.toISOString()).toBe('2026-04-20T09:00:00.000Z');
  });

  /** Stripe rejoue jusqu'a obtenir un 2xx. Crediter deux fois serait un cadeau. */
  it('ne credite qu une fois le meme evenement', async () => {
    const fake = fakePrisma(row({ plan: 'apprenti', credits: 0 }));
    const service = billing(fake.db);
    const { body, signature } = signed(invoice('in_1', '2026-03-20T09:00:00Z'));

    await service.handle(body, signature);
    await service.handle(body, signature);

    expect(fake.entries).toHaveLength(1);
    expect(fake.row.credits).toBe(planOf('apprenti').monthly);
  });

  it('ignore une facture d un client qu on ne connait pas', async () => {
    const fake = fakePrisma(row({ stripeCustomerId: 'cus_autre' }));
    const service = billing(fake.db);
    const { body, signature } = signed(invoice('in_1', '2026-03-20T09:00:00Z'));

    await service.handle(body, signature);

    expect(fake.entries).toHaveLength(0);
  });
});
