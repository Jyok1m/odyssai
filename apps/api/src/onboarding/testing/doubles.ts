import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@odyssai/db';

/*
  Prisma en memoire, reduit aux tables du parcours. Assez fidele pour que
  l'aller-retour complet soit un vrai test : les lignes persistent d'un appel
  a l'autre, ce qu'un `vi.fn()` ne dirait pas.
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
  // L'histoire ouverte : SetNull quand elle est supprimee, comme en base.
  currentUniverseId: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UniverseRow {
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
  // Ou en est l'histoire. Nul pour un monde genere avant les arcs, et la base
  // rend bien `null` : la colonne absente du double rendait `undefined`, que
  // le schema de vue refuse.
  arcAct: number | null;
  // Ferme par defaut : un monde appartient a son createur.
  isOpen: boolean;
  // Le monde que cette histoire visite, quand elle en visite un.
  visitingId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CharacterRow {
  id: string;
  universeId: string | null;
  name: string | null;
  gender: string | null;
  age: number | null;
  personality: unknown;
  attributes: unknown;
  talents: string[];
  inventory: string[];
  progress: unknown;
  // La jauge de vie, tenue par le code. Nulle vaut la reserve pleine.
  hp: number | null;
  rest: number;
  // L'essence dont ce personnage est une incarnation, et comment il est entre.
  essenceId: string | null;
  arrival: string;
  diedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/*
  Ce qu'un personnage emporte en franchissant une faille. Le double n'en cree
  que par le parcours : une fiche validee fait naitre la sienne.
*/
interface EssenceRow {
  id: string;
  ownerId: string;
  name: string;
  gender: string;
  age: number;
  personality: unknown;
  attributes: unknown;
  marks: unknown;
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

/*
  Les paliers, en base depuis qu'ils s'editent au tableau de bord. Le double
  en porte les trois que la migration amorce : sans eux, ouvrir un abonnement
  n'aurait aucune dotation a servir.
*/
interface PlanRow {
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

const SEEDED_PLANS: PlanRow[] = [
  seedPlan('free', 'Libre', 30, 25, null, null, 0),
  seedPlan('apprenti', 'Apprenti', 300, 0, 500, 'price_apprenti', 1),
  seedPlan('arpenteur', 'Arpenteur', 1000, 0, 1200, 'price_arpenteur', 2),
];

function seedPlan(
  slug: string,
  name: string,
  monthlyCredits: number,
  welcomeCredits: number,
  amountCents: number | null,
  stripePriceId: string | null,
  sortOrder: number,
): PlanRow {
  return {
    id: `plan-${slug}`,
    slug,
    name,
    monthlyCredits,
    welcomeCredits,
    amountCents,
    currency: 'eur',
    stripeProductId: stripePriceId ? `prod_${slug}` : null,
    stripePriceId,
    archived: false,
    sortOrder,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

// Sert aux tests qui veulent affirmer une dotation sans la recopier.
export const PLAN_FIXTURES = SEEDED_PLANS;

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
  // Rang dans son canal, unique par univers : la base le contraint.
  seq: number;
  createdAt: Date;
}

interface JobRow {
  id: string;
  universeId: string;
  status: string;
  step: string | null;
  attempts: number;
  error: string | null;
  // Quand les credits de cette generation ont ete rendus.
  refundedAt: Date | null;
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
  essences?: EssenceRow[];
  subscriptions?: SubscriptionRow[];
  creditEntries?: CreditEntryRow[];
  stripeEvents?: StripeEventRow[];
  // Absent, les trois paliers amorces par la migration sont servis.
  plans?: PlanRow[];
  // Absente, le jeu est ouvert : c'est l'etat que presque tous les tests veulent.
  siteSettings?: SiteSettingsRow;
}

export interface SiteSettingsRow {
  id: true;
  alphaPhase: string;
  alphaNotice: boolean;
  updatedAt: Date;
}

const OPEN_SETTINGS: SiteSettingsRow = {
  id: true,
  alphaPhase: 'open',
  alphaNotice: false,
  updatedAt: new Date(0),
};

function matchMessages(store: OnboardingStore, where: any): MessageRow[] {
  return store.messages.filter(
    (row) =>
      row.universeId === where.universeId &&
      row.channel === where.channel &&
      (where.role === undefined || row.role === where.role),
  );
}

function sortMessages(rows: MessageRow[], orderBy: any): MessageRow[] {
  if (orderBy?.seq) {
    const sign = orderBy.seq === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => sign * (a.seq - b.seq));
  }

  const sign = orderBy?.createdAt === 'desc' ? -1 : 1;
  return [...rows].sort(
    (a, b) => sign * (a.createdAt.getTime() - b.createdAt.getTime()),
  );
}

function project(rows: MessageRow[], select: any): any[] {
  if (!select) return rows.map((row) => ({ ...row }));
  return rows.map((row) =>
    Object.fromEntries(
      Object.keys(select).map((key) => [key, (row as any)[key]]),
    ),
  );
}

// `Prisma.DbNull` est un marqueur, pas une valeur : la colonne recoit NULL.
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
    currentUniverseId: null,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeOnboardingPrisma(store: OnboardingStore) {
  const hydrate = (
    universe: UniverseRow | undefined,
    include?: {
      character?: unknown;
      jobs?: { take?: number };
      entities?: unknown;
      canon?: unknown;
      visiting?: unknown;
    },
  ): any => {
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
      // Aucun test n'en seme : ce qui compte est que la vue en porte une liste.
      entities: include.entities ? [] : undefined,
      canon: include.canon ? [] : undefined,
      /*
        Aucun test ne joue de visite : ce qui compte est que la lecture d'une
        histoire ordinaire ne trouve pas un monde emprunte la ou il n'y en a
        pas.
      */
      visiting: include.visiting
        ? (hydrate(
            store.universes.find((row) => row.id === universe.visitingId),
            { entities: true, canon: true },
          ) ?? null)
        : undefined,
    };
  };

  const double = {
    // Le lore qui grandit n'est pas joue de bout en bout : rien n'y ecrit.
    entity: {
      findMany: async () => [],
      createMany: async () => ({ count: 0 }),
      create: async ({ data }: any) => data,
      update: async ({ data }: any) => data,
      upsert: async ({ create }: any) => create,
      // Rien n'en seme, donc rien n'attend d'etre relu.
      groupBy: async () => [],
    },

    /*
      Le canon n'est pas joue de bout en bout non plus : il naît au tour, et
      le tour a son propre double. Seule la lecture compte ici.
    */
    canonFact: {
      findMany: async () => [],
      create: async ({ data }: any) => data,
      update: async ({ data }: any) => data,
      groupBy: async () => [],
    },

    /*
      Ce qu'un personnage emporte en franchissant une faille. Le parcours en
      cree une a la premiere fiche validee : c'est le seul ecrivain de bout en
      bout, et les tests le traversent.
    */
    essence: {
      findMany: async ({ where }: any = {}) =>
        (store.essences ?? [])
          .filter((row) => where?.ownerId === undefined || row.ownerId === where.ownerId)
          .map((row) => ({ ...row, incarnations: [] })),
      findUnique: async ({ where }: any) => {
        const row = (store.essences ?? []).find(
          (item) =>
            item.id === where.id &&
            (where.ownerId === undefined || item.ownerId === where.ownerId),
        );
        return row ? { ...row, incarnations: [] } : null;
      },
      findFirst: async ({ where }: any = {}) =>
        (store.essences ?? []).find(
          (row) => where?.ownerId === undefined || row.ownerId === where.ownerId,
        ) ?? null,
      create: async ({ data, select }: any) => {
        const now = new Date();
        const row: EssenceRow = {
          id: randomUUID(),
          ownerId: data.ownerId,
          name: data.name,
          gender: data.gender,
          age: data.age,
          personality: data.personality ?? null,
          attributes: data.attributes ?? null,
          marks: [],
          createdAt: now,
          updatedAt: now,
        };
        store.essences = [...(store.essences ?? []), row];

        if (!select) return { ...row };
        return Object.fromEntries(
          Object.keys(select).map((key) => [key, (row as any)[key]]),
        );
      },
      update: async ({ where, data }: any) => {
        const row = (store.essences ?? []).find((item) => item.id === where.id)!;
        return { ...assign(row, data) };
      },
      delete: async ({ where }: any) => {
        store.essences = (store.essences ?? []).filter((row) => row.id !== where.id);
        return {};
      },
      count: async ({ where }: any = {}) =>
        (store.essences ?? []).filter(
          (row) => where?.essenceId === undefined || row.id === where.essenceId,
        ).length,
    },
    user: {
      /*
        Deux filtres suffisent, ce sont les seuls que le code pose : le droit
        d'administration pour les places de l'alpha, et l'anteriorite pour le
        rang des premiers arrives.
      */
      count: async ({ where }: any) =>
        store.users.filter((user) => {
          if (where?.isAdmin !== undefined && user.isAdmin !== where.isAdmin) {
            return false;
          }
          if (where?.createdAt?.lt && !(user.createdAt < where.createdAt.lt)) {
            return false;
          }
          return true;
        }).length,
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
      updateMany: async ({ where, data }: any) => {
        const rows = store.users.filter(
          (user) =>
            user.id === where.id &&
            (where.currentUniverseId === undefined ||
              user.currentUniverseId === where.currentUniverseId),
        );
        for (const row of rows) assign(row, data);
        return { count: rows.length };
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
        // `id` est la cle ; `ownerId` s'y ajoute comme filtre, jamais seul.
        const row = store.universes.find(
          (universe) =>
            universe.id === where.id &&
            (where.ownerId === undefined || universe.ownerId === where.ownerId),
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
      findMany: async ({ where, orderBy, select, include }: any = {}) => {
        const rows = store.universes
          .filter((row) => where?.ownerId === undefined || row.ownerId === where.ownerId)
          // Les visites d'un monde : aucun test n'en joue, donc aucune ligne.
          .filter(() => where?.visiting === undefined && where?.visitingId === undefined)
          .sort((a, b) =>
            (orderBy?.createdAt === 'desc' ? -1 : 1) *
            (a.createdAt.getTime() - b.createdAt.getTime()),
          );
        return rows.map((row) => {
          const hydrated = hydrate(row, include) as Record<string, unknown>;
          if (!select) return hydrated;
          return Object.fromEntries(
            Object.keys(select).map((key) => [key, hydrated[key]]),
          );
        });
      },
      count: async ({ where }: any = {}) =>
        store.universes.filter(
          (row) => where?.ownerId === undefined || row.ownerId === where.ownerId,
        ).length,
      create: async ({ data, select }: any) => {
        const now = new Date();
        const row: UniverseRow = {
          id: randomUUID(),
          ownerId: data.ownerId ?? null,
          step: 'inspiration',
          mode: null,
          works: [],
          ownDescription: null,
          themes: null,
          charter: null,
          bible: null,
          name: null,
          accentHue: null,
          arcAct: null,
          isOpen: false,
          visitingId: null,
          createdAt: now,
          updatedAt: now,
        };
        assign(row, data);
        store.universes.push(row);

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
      // Cascade sur messages, travaux et rencontres ; SetNull sur le
      // personnage et sur l'histoire ouverte des joueurs.
      delete: async ({ where }: any) => {
        store.universes = store.universes.filter((row) => row.id !== where.id);
        for (const user of store.users) {
          if (user.currentUniverseId === where.id) user.currentUniverseId = null;
        }
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
      findUnique: async ({ where, select }: any) => {
        const row = store.characters.find((item) =>
          where.id ? item.id === where.id : item.universeId === where.universeId,
        );
        if (!row) return null;
        if (!select) return { ...row };
        return Object.fromEntries(
          Object.keys(select).map((key) => [key, (row as any)[key]]),
        );
      },
      update: async ({ where, data }: any) => {
        const row = store.characters.find((item) =>
          where.id ? item.id === where.id : item.universeId === where.universeId,
        )!;
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
          talents: [],
          inventory: [],
          progress: null,
          hp: null,
          rest: 0,
          essenceId: null,
          arrival: 'natif',
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
      findMany: async ({ where, orderBy, select }: any) =>
        project(sortMessages(matchMessages(store, where), orderBy), select),
      findFirst: async ({ where, orderBy, select }: any) => {
        const [row] = sortMessages(matchMessages(store, where), orderBy);
        return row ? project([row], select)[0] : null;
      },
      create: async ({ data }: any) => {
        const seq = data.seq ?? 0;

        // La contrainte d'unicite est reproduite ici : sans elle, le double
        // acceptait ce que la base refuse, et le defaut a zero passait tous
        // les tests avant d'echouer au premier vrai second message.
        const clash = store.messages.some(
          (row) =>
            row.universeId === data.universeId &&
            row.channel === data.channel &&
            row.seq === seq,
        );
        if (clash) {
          throw Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
          });
        }

        const row: MessageRow = {
          id: randomUUID(),
          universeId: data.universeId,
          channel: data.channel,
          role: data.role,
          content: data.content,
          seq,
          // Les messages d'un meme test naissent dans la meme milliseconde :
          // sans ce decalage, leur ordre de lecture serait indefini. C'est
          // exactement ce que le rang evite en base.
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
      /*
        Le solde d'une generation qui a echoue passe par la : les travaux qui
        n'ont pas encore rendu leurs credits, puis le verrou qui designe qui
        rembourse.
      */
      findMany: async ({ where }: any = {}) =>
        store.jobs
          .filter(
            (row) =>
              (where?.universeId === undefined || row.universeId === where.universeId) &&
              (where?.status === undefined || row.status === where.status) &&
              (where?.refundedAt === undefined || row.refundedAt === null),
          )
          .map((row) => ({ ...row })),
      updateMany: async ({ where, data }: any) => {
        const rows = store.jobs.filter(
          (row) =>
            (where?.id === undefined || row.id === where.id) &&
            (where?.refundedAt === undefined || row.refundedAt === null),
        );
        for (const row of rows) assign(row, data);
        return { count: rows.length };
      },
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
          refundedAt: null,
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
      // Le grand livre repond a « lequel reste-t-il a rendre ».
      findMany: async ({ where, select }: any = {}) => {
        const rows = (store.creditEntries ?? []).filter((row) => {
          if (where?.reason !== undefined && row.reason !== where.reason) return false;
          if (where?.ref !== undefined) {
            const wanted = where.ref?.in ?? where.ref;
            if (Array.isArray(wanted) ? !wanted.includes(row.ref) : row.ref !== wanted) {
              return false;
            }
          }
          if (where?.delta?.lt !== undefined && !(row.delta < where.delta.lt)) {
            return false;
          }
          return true;
        });

        return rows.map((row) =>
          select
            ? Object.fromEntries(
                Object.keys(select).map((key) => [key, (row as any)[key]]),
              )
            : { ...row },
        );
      },
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
    },

    /*
      La cle primaire porte l'idempotence des webhooks : un meme identifiant
      deux fois doit echouer, comme en base.
    */
    siteSettings: {
      findUnique: async () => ({ ...(store.siteSettings ?? OPEN_SETTINGS) }),
      upsert: async () => ({ ...(store.siteSettings ?? OPEN_SETTINGS) }),
      update: async ({ data }: any) => {
        store.siteSettings = { ...(store.siteSettings ?? OPEN_SETTINGS), ...data };
        return { ...store.siteSettings };
      },
    },

    plan: {
      findUnique: async ({ where }: any) => {
        const rows = store.plans ?? SEEDED_PLANS;
        const found = rows.find((row) =>
          where.slug !== undefined
            ? row.slug === where.slug
            : where.stripePriceId !== undefined
              ? row.stripePriceId === where.stripePriceId
              : row.id === where.id,
        );
        return found ? { ...found } : null;
      },
      findMany: async ({ where }: any = {}) => {
        const rows = store.plans ?? SEEDED_PLANS;
        return rows
          .filter((row) => (where?.archived === false ? !row.archived : true))
          .filter((row) =>
            where?.stripePriceId?.not === null ? row.stripePriceId !== null : true,
          )
          .map((row) => ({ ...row }));
      },
    },

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

    /*
      Aucune extension dans un double : le rappel long se degrade, et c'est
      ce que les tests doivent voir.
    */
    $queryRawUnsafe: async () => [{ ok: false }],

    guideQuestion: {
      create: async () => ({}),
      deleteMany: async () => ({ count: 0 }),
    },

    $disconnect: async () => {},
  };

  return double as unknown as PrismaClient;
}
