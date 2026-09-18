import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@odyssai/db';

/**
 * Un double centre sur l'administration.
 *
 * Distinct de `makeOnboardingPrisma`, qui porte deja tout le parcours
 * d'entree : y ajouter les agregats, les comptages et le CRUD des paliers
 * l'aurait rendu illisible pour les tests qui n'en ont que faire.
 */

export interface AdminUserRow {
  id: string;
  keycloakId: string;
  username: string | null;
  usernameFolded: string | null;
  email: string;
  emailVerified: boolean;
  locale: 'fr' | 'en';
  isAdmin: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminPlanRow {
  id: string;
  slug: string;
  name: string;
  monthlyCredits: number;
  welcomeCredits: number;
  amountCents: number | null;
  currency: string;
  stripeProductId: string | null;
  stripePriceId: string | null;
  archived: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminSubscriptionRow {
  id: string;
  userId: string;
  plan: string;
  status: string;
  credits: number;
  periodStart: Date;
  periodEnd: Date;
  welcomed: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface AdminEntryRow {
  id: string;
  subscriptionId: string;
  delta: number;
  reason: string;
  ref: string | null;
  balance: number;
  createdAt: Date;
}

export interface AdminStore {
  users: AdminUserRow[];
  plans: AdminPlanRow[];
  subscriptions: AdminSubscriptionRow[];
  entries: AdminEntryRow[];
}

/** Les trois paliers que la migration amorce. */
export function seededPlans(): AdminPlanRow[] {
  const at = new Date('2026-01-01T00:00:00Z');
  return [
    {
      id: 'plan-free',
      slug: 'free',
      name: 'Libre',
      monthlyCredits: 30,
      welcomeCredits: 25,
      amountCents: null,
      currency: 'eur',
      stripeProductId: null,
      stripePriceId: null,
      archived: false,
      sortOrder: 0,
      createdAt: at,
      updatedAt: at,
    },
    {
      id: 'plan-apprenti',
      slug: 'apprenti',
      name: 'Apprenti',
      monthlyCredits: 300,
      welcomeCredits: 0,
      amountCents: 500,
      currency: 'eur',
      stripeProductId: 'prod_apprenti',
      stripePriceId: 'price_apprenti',
      archived: false,
      sortOrder: 1,
      createdAt: at,
      updatedAt: at,
    },
  ];
}

export function adminUser(overrides: Partial<AdminUserRow> = {}): AdminUserRow {
  const now = new Date('2026-02-01T00:00:00Z');
  return {
    id: randomUUID(),
    keycloakId: `sujet-${randomUUID()}`,
    username: null,
    usernameFolded: null,
    email: 'joueuse@example.test',
    emailVerified: true,
    locale: 'fr',
    isAdmin: false,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeAdminPrisma(store: AdminStore) {
  const matches = (row: AdminUserRow, where: any): boolean => {
    if (!where) return true;

    if (where.OR) {
      const needle = String(
        where.OR[0]?.username?.contains ?? where.OR[0]?.email?.contains ?? '',
      ).toLowerCase();
      const hit =
        (row.username ?? '').toLowerCase().includes(needle) ||
        row.email.toLowerCase().includes(needle);
      if (!hit) return false;
    }

    if (where.username?.not === null && row.username === null) return false;

    if (where.subscription?.plan) {
      const own = store.subscriptions.find((sub) => sub.userId === row.id);
      if (own?.plan !== where.subscription.plan) return false;
    }

    return true;
  };

  const withSubscription = (row: AdminUserRow) => ({
    ...row,
    subscription:
      store.subscriptions.find((sub) => sub.userId === row.id) ?? null,
  });

  const double: any = {
    user: {
      count: async ({ where }: any = {}) =>
        store.users.filter((row) => matches(row, where)).length,
      findUnique: async ({ where }: any) =>
        store.users.find((row) =>
          where.keycloakId !== undefined
            ? row.keycloakId === where.keycloakId
            : row.id === where.id,
        ) ?? null,

      // SessionGuard resout le joueur par son `sub` a chaque requete : sans
      // cet upsert, aucune route gardee n'est joignable.
      upsert: async ({ where, create, update }: any) => {
        const row = store.users.find((item) => item.keycloakId === where.keycloakId);
        if (row) {
          Object.assign(row, update, { updatedAt: new Date() });
          return { ...row };
        }

        const created = adminUser({ ...create, keycloakId: where.keycloakId });
        store.users.push(created);
        return { ...created };
      },
      findMany: async ({ where, take, cursor, skip, include }: any = {}) => {
        let rows = store.users
          .filter((row) => matches(row, where))
          .sort((a, b) => (a.id < b.id ? 1 : -1));

        if (cursor) {
          const at = rows.findIndex((row) => row.id === cursor.id);
          rows = at >= 0 ? rows.slice(at + (skip ?? 0)) : rows;
        }
        if (take) rows = rows.slice(0, take);

        return rows.map((row) => (include?.subscription ? withSubscription(row) : { ...row }));
      },
    },

    plan: {
      findUnique: async ({ where }: any) =>
        store.plans.find((row) =>
          where.slug !== undefined
            ? row.slug === where.slug
            : where.stripePriceId !== undefined
              ? row.stripePriceId === where.stripePriceId
              : row.id === where.id,
        ) ?? null,
      findMany: async ({ where }: any = {}) =>
        store.plans
          .filter((row) => (where?.archived === false ? !row.archived : true))
          .filter((row) =>
            where?.stripePriceId?.not === null ? row.stripePriceId !== null : true,
          )
          .map((row) => ({ ...row })),
      create: async ({ data }: any) => {
        const row: AdminPlanRow = {
          id: randomUUID(),
          slug: data.slug,
          name: data.name,
          monthlyCredits: data.monthlyCredits,
          welcomeCredits: data.welcomeCredits ?? 0,
          amountCents: data.amountCents ?? null,
          currency: data.currency ?? 'eur',
          stripeProductId: data.stripeProductId ?? null,
          stripePriceId: data.stripePriceId ?? null,
          archived: false,
          sortOrder: data.sortOrder ?? 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.plans.push(row);
        return { ...row };
      },
      update: async ({ where, data }: any) => {
        const row = store.plans.find((item) => item.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
      delete: async ({ where }: any) => {
        const at = store.plans.findIndex((row) => row.id === where.id);
        const [removed] = store.plans.splice(at, 1);
        return removed;
      },
    },

    subscription: {
      findUnique: async ({ where }: any) =>
        store.subscriptions.find((row) =>
          where.id ? row.id === where.id : row.userId === where.userId,
        ) ?? null,
      count: async ({ where }: any = {}) =>
        store.subscriptions.filter((row) => (where?.plan ? row.plan === where.plan : true))
          .length,
      groupBy: async () => {
        const counted = new Map<string, number>();
        for (const row of store.subscriptions) {
          counted.set(row.plan, (counted.get(row.plan) ?? 0) + 1);
        }
        return [...counted].map(([plan, count]) => ({ plan, _count: { _all: count } }));
      },
      create: async ({ data }: any) => {
        const row: AdminSubscriptionRow = {
          id: randomUUID(),
          userId: data.userId,
          plan: data.plan ?? 'free',
          status: data.status ?? 'active',
          credits: data.credits ?? 0,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          welcomed: data.welcomed ?? false,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          cancelAtPeriodEnd: false,
        };
        store.subscriptions.push(row);
        return { ...row };
      },
      update: async ({ where, data }: any) => {
        const row = store.subscriptions.find((item) =>
          where.id ? item.id === where.id : item.userId === where.userId,
        )!;
        if (data.credits?.increment !== undefined) row.credits += data.credits.increment;
        else if (data.credits !== undefined) row.credits = data.credits;
        for (const [key, value] of Object.entries(data)) {
          if (key !== 'credits') (row as any)[key] = value;
        }
        return { ...row };
      },
      findMany: async ({ select }: any = {}) =>
        store.subscriptions.map((row) =>
          select ? { plan: row.plan, credits: row.credits, status: row.status } : { ...row },
        ),
    },

    creditEntry: {
      create: async ({ data }: any) => {
        const row: AdminEntryRow = {
          id: randomUUID(),
          subscriptionId: data.subscriptionId,
          delta: data.delta,
          reason: data.reason,
          ref: data.ref ?? null,
          balance: data.balance,
          createdAt: new Date(),
        };
        store.entries.push(row);
        return { ...row };
      },
      findUnique: async ({ where }: any) =>
        store.entries.find((row) => row.id === where.id) ?? null,
      findMany: async ({ where }: any = {}) =>
        store.entries
          .filter((row) =>
            where?.subscriptionId ? row.subscriptionId === where.subscriptionId : true,
          )
          .map((row) => ({ ...row })),
    },

    universe: { count: async () => 0 },
    turn: { count: async () => 0 },
    llmUsage: { aggregate: async () => ({ _sum: { costUsd: null } }) },
    guideQuestion: { create: async () => ({}), deleteMany: async () => ({ count: 0 }) },

    $transaction: async (run: any) => run(double),
    $queryRawUnsafe: async () => [{ ok: false }],
    $disconnect: async () => {},
  };

  return double as unknown as PrismaClient;
}
