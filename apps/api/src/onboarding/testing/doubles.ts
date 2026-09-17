import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@odyssai/db';

/**
 * Prisma en memoire, reduit aux tables du parcours. Assez fidele pour que
 * l'aller-retour complet soit un vrai test : les lignes persistent d'un appel
 * a l'autre, ce qu'un `vi.fn()` ne dirait pas.
 */
interface UserRow {
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

interface UniverseRow {
  id: string;
  ownerId: string | null;
  step: string;
  mode: string | null;
  works: string[];
  ownDescription: string | null;
  themes: unknown;
  charter: unknown;
  bible: unknown;
  name: string | null;
  accentHue: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CharacterRow {
  id: string;
  universeId: string | null;
  name: string | null;
  gender: string | null;
  age: number | null;
  personality: unknown;
  attributes: unknown;
  diedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SubscriptionRow {
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

interface CreditEntryRow {
  id: string;
  subscriptionId: string;
  delta: number;
  reason: string;
  ref: string | null;
  balance: number;
  createdAt: Date;
}

interface StripeEventRow {
  id: string;
  type: string;
  createdAt: Date;
}

interface EncounterRow {
  id: string;
  visitorId: string;
  universeId: string;
  characterId: string | null;
  createdAt: Date;
}

interface MessageRow {
  id: string;
  universeId: string;
  channel: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

interface JobRow {
  id: string;
  universeId: string;
  status: string;
  step: string | null;
  attempts: number;
  error: string | null;
  traceId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export interface OnboardingStore {
  users: UserRow[];
  universes: UniverseRow[];
  characters: CharacterRow[];
  messages: MessageRow[];
  jobs: JobRow[];
  encounters?: EncounterRow[];
  subscriptions?: SubscriptionRow[];
  creditEntries?: CreditEntryRow[];
  stripeEvents?: StripeEventRow[];
}

/** `Prisma.DbNull` est un marqueur, pas une valeur : la colonne recoit NULL. */
function value(raw: unknown): unknown {
  return raw === Prisma.DbNull || raw === Prisma.JsonNull ? null : raw;
}

function assign<T extends object>(row: T, data: Record<string, unknown>): T {
  for (const [key, raw] of Object.entries(data)) {
    (row as Record<string, unknown>)[key] = value(raw);
  }
  return row;
}

export function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  const now = new Date();
  return {
    id: randomUUID(),
    keycloakId: 'sujet-de-test',
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

export function makeOnboardingPrisma(store: OnboardingStore) {
  const hydrate = (
    universe: UniverseRow | undefined,
    include?: { character?: boolean; jobs?: { take?: number } },
  ) => {
    if (!universe) return null;
    if (!include) return { ...universe };

    const jobs = store.jobs
      .filter((job) => job.universeId === universe.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return {
      ...universe,
      character: include.character
        ? (store.characters.find((row) => row.universeId === universe.id) ?? null)
        : undefined,
      jobs: include.jobs ? jobs.slice(0, include.jobs.take ?? jobs.length) : undefined,
    };
  };

  const double = {
    user: {
      findUnique: async ({ where, select }: any) => {
        const row = store.users.find((user) =>
          where.id ? user.id === where.id : user.keycloakId === where.keycloakId,
        );
        if (!row) return null;
        if (!select) return { ...row };
        return Object.fromEntries(
          Object.keys(select).map((key) => [key, (row as any)[key]]),
        );
      },
      upsert: async ({ where, create, update }: any) => {
        const existing = store.users.find(
          (user) => user.keycloakId === where.keycloakId,
        );
        if (existing) return { ...assign(existing, update) };

        const row = makeUser({ ...create });
        store.users.push(row);
        return { ...row };
      },
      update: async ({ where, data }: any) => {
        const row = store.users.find((user) => user.id === where.id)!;
        return { ...assign(row, data) };
      },
      // SetNull sur universes.owner_id : le monde survit, detache.
      delete: async ({ where }: any) => {
        const row = store.users.find((user) => user.id === where.id)!;
        store.users = store.users.filter((user) => user.id !== where.id);
        for (const universe of store.universes) {
          if (universe.ownerId === where.id) universe.ownerId = null as any;
        }
        return { ...row };
      },
    },

    universe: {
      findUnique: async ({ where, include, select }: any) => {
        const row = store.universes.find((universe) =>
          where.id ? universe.id === where.id : universe.ownerId === where.ownerId,
        );
        if (!row) return null;
        if (!select) return hydrate(row, include);

        // `select` peut porter une relation, comme `jobs` : on la sert par la
        // meme hydratation, et les colonnes simples par leur nom.
        const hydrated = hydrate(row, {
          character: select.character !== undefined,
          jobs: typeof select.jobs === 'object' ? select.jobs : undefined,
        }) as Record<string, unknown>;

        return Object.fromEntries(
          Object.keys(select).map((key) => [key, hydrated[key]]),
        );
      },
      findUniqueOrThrow: async ({ where, include }: any) => {
        const row = hydrate(
          store.universes.find((universe) => universe.id === where.id),
          include,
        );
        if (!row) throw new Error('univers absent');
        return row;
      },
      upsert: async ({ where, create, update, select }: any) => {
        let row = store.universes.find(
          (universe) => universe.ownerId === where.ownerId,
        );

        if (row) {
          assign(row, update);
        } else {
          const now = new Date();
          row = {
            id: randomUUID(),
            ownerId: create.ownerId,
            step: 'inspiration',
            mode: null,
            works: [],
            ownDescription: null,
            themes: null,
            charter: null,
            bible: null,
            name: null,
            accentHue: null,
            createdAt: now,
            updatedAt: now,
          };
          store.universes.push(row);
        }

        if (!select) return { ...row };
        return Object.fromEntries(
          Object.keys(select).map((key) => [key, (row as any)[key]]),
        );
      },
      update: async ({ where, data, include }: any) => {
        const row = store.universes.find((universe) => universe.id === where.id)!;
        assign(row, data);
        row.updatedAt = new Date();
        return hydrate(row, include);
      },
      /** Cascade sur messages, travaux et rencontres ; SetNull sur le personnage. */
      delete: async ({ where }: any) => {
        store.universes = store.universes.filter((row) => row.id !== where.id);
        store.messages = store.messages.filter((row) => row.universeId !== where.id);
        store.jobs = store.jobs.filter((row) => row.universeId !== where.id);
        store.encounters = (store.encounters ?? []).filter(
          (row) => row.universeId !== where.id,
        );
        for (const character of store.characters) {
          if (character.universeId === where.id) character.universeId = null as any;
        }
        return {};
      },
    },

    character: {
      update: async ({ where, data }: any) => {
        const row = store.characters.find((item) => item.id === where.id)!;
        return { ...assign(row, data) };
      },
      delete: async ({ where }: any) => {
        store.characters = store.characters.filter((row) => row.id !== where.id);
        store.encounters = (store.encounters ?? []).filter(
          (row) => row.characterId !== where.id,
        );
        return {};
      },
      upsert: async ({ where, create, update }: any) => {
        const existing = store.characters.find(
          (row) => row.universeId === where.universeId,
        );
        if (existing) return { ...assign(existing, update) };

        const now = new Date();
        const row: CharacterRow = {
          id: randomUUID(),
          universeId: where.universeId,
          name: null,
          gender: null,
          age: null,
          personality: null,
          attributes: null,
          diedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        assign(row, create);
        store.characters.push(row);
        return { ...row };
      },
    },

    encounter: {
      count: async ({ where }: any) =>
        (store.encounters ?? []).filter((row) => {
          if (where.universeId !== undefined && row.universeId !== where.universeId) {
            return false;
          }
          if (where.characterId !== undefined && row.characterId !== where.characterId) {
            return false;
          }
          return where.visitorId?.not === undefined
            ? true
            : row.visitorId !== where.visitorId.not;
        }).length,
    },

    conversationMessage: {
      findMany: async ({ where, orderBy, select }: any) => {
        const rows = store.messages
          .filter(
            (row) =>
              row.universeId === where.universeId &&
              row.channel === where.channel &&
              (where.role === undefined || row.role === where.role),
          )
          .sort((a, b) =>
            orderBy?.createdAt === 'desc'
              ? b.createdAt.getTime() - a.createdAt.getTime()
              : a.createdAt.getTime() - b.createdAt.getTime(),
          );

        if (!select) return rows.map((row) => ({ ...row }));
        return rows.map((row) =>
          Object.fromEntries(
            Object.keys(select).map((key) => [key, (row as any)[key]]),
          ),
        );
      },
      create: async ({ data }: any) => {
        const row: MessageRow = {
          id: randomUUID(),
          universeId: data.universeId,
          channel: data.channel,
          role: data.role,
          content: data.content,
          // Les messages d'un meme test naissent dans la meme milliseconde :
          // sans ce decalage, leur ordre de lecture serait indefini.
          createdAt: new Date(Date.now() + store.messages.length),
        };
        store.messages.push(row);
        return { ...row };
      },
      count: async ({ where }: any) =>
        store.messages.filter(
          (row) =>
            row.universeId === where.universeId &&
            row.channel === where.channel &&
            (where.role === undefined || row.role === where.role),
        ).length,
      deleteMany: async ({ where }: any) => {
        const kept = store.messages.filter((row) => row.universeId !== where.universeId);
        const count = store.messages.length - kept.length;
        store.messages = kept;
        return { count };
      },
    },

    generationJob: {
      deleteMany: async ({ where }: any) => {
        const kept = store.jobs.filter((row) => row.universeId !== where.universeId);
        const count = store.jobs.length - kept.length;
        store.jobs = kept;
        return { count };
      },
      create: async ({ data }: any) => {
        const row: JobRow = {
          id: randomUUID(),
          universeId: data.universeId,
          status: 'queued',
          step: null,
          attempts: 0,
          error: null,
          traceId: null,
          startedAt: null,
          finishedAt: null,
          createdAt: new Date(),
        };
        store.jobs.push(row);
        return { ...row };
      },
    },

    $transaction: async (run: any) => run(double),

    subscription: {
      findUnique: async ({ where }: any) =>
        (store.subscriptions ?? []).find((row) => {
          if (where.id) return row.id === where.id;
          if (where.stripeCustomerId) {
            return row.stripeCustomerId === where.stripeCustomerId;
          }
          return row.userId === where.userId;
        }) ?? null,
      create: async ({ data }: any) => {
        const row: SubscriptionRow = {
          id: randomUUID(),
          userId: data.userId,
          plan: data.plan ?? 'free',
          status: data.status ?? 'active',
          credits: data.credits ?? 0,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          welcomed: data.welcomed ?? false,
          stripeCustomerId: data.stripeCustomerId ?? null,
          stripeSubscriptionId: data.stripeSubscriptionId ?? null,
          cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false,
        };
        store.subscriptions = [...(store.subscriptions ?? []), row];
        return { ...row };
      },
      update: async ({ where, data }: any) => {
        const row = (store.subscriptions ?? []).find((item) =>
          where.id ? item.id === where.id : item.userId === where.userId,
        )!;
        // `increment` est la seule operation atomique employee par le service.
        if (data.credits?.increment !== undefined) {
          row.credits += data.credits.increment;
        } else if (data.credits !== undefined) {
          row.credits = data.credits;
        }
        for (const [key, value] of Object.entries(data)) {
          if (key !== 'credits') (row as any)[key] = value;
        }
        return { ...row };
      },
    },

    creditEntry: {
      create: async ({ data }: any) => {
        const row: CreditEntryRow = {
          id: randomUUID(),
          subscriptionId: data.subscriptionId,
          delta: data.delta,
          reason: data.reason,
          ref: data.ref ?? null,
          balance: data.balance,
          createdAt: new Date(),
        };
        store.creditEntries = [...(store.creditEntries ?? []), row];
        return { ...row };
      },
      findUnique: async ({ where }: any) =>
        (store.creditEntries ?? []).find((row) => row.id === where.id) ?? null,
      findMany: async () => [...(store.creditEntries ?? [])],
    },

    /** La cle primaire porte l'idempotence des webhooks : un meme identifiant
     * deux fois doit echouer, comme en base. */
    stripeEvent: {
      create: async ({ data }: any) => {
        store.stripeEvents = store.stripeEvents ?? [];
        if (store.stripeEvents.some((row) => row.id === data.id)) {
          throw new Error('doublon');
        }
        const row = { id: data.id, type: data.type, createdAt: new Date() };
        store.stripeEvents.push(row);
        return { ...row };
      },
    },

    /** Aucune extension dans un double : le rappel long se degrade, et c'est
     * ce que les tests doivent voir. */
    $queryRawUnsafe: async () => [{ ok: false }],

    guideQuestion: {
      create: async () => ({}),
      deleteMany: async () => ({ count: 0 }),
    },

    $disconnect: async () => {},
  };

  return double as unknown as PrismaClient;
}
