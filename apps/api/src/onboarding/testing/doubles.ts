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
  ownerId: string;
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
  universeId: string;
  name: string | null;
  gender: string | null;
  age: number | null;
  personality: unknown;
  attributes: unknown;
  createdAt: Date;
  updatedAt: Date;
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
  jobs: JobRow[];
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
    },

    universe: {
      findUnique: async ({ where, include }: any) =>
        hydrate(
          store.universes.find((universe) =>
            where.id ? universe.id === where.id : universe.ownerId === where.ownerId,
          ),
          include,
        ),
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
    },

    character: {
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
          createdAt: now,
          updatedAt: now,
        };
        assign(row, create);
        store.characters.push(row);
        return { ...row };
      },
    },

    generationJob: {
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

    guideQuestion: {
      create: async () => ({}),
      deleteMany: async () => ({ count: 0 }),
    },

    $disconnect: async () => {},
  };

  return double as unknown as PrismaClient;
}
