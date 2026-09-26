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
  // Le joueur qui l'incarne : une fiche par joueur et par univers.
  ownerId: string | null;
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
  // Le membre auquel ce message appartient, nul hors d'une table.
  memberId: string | null;
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
  bugs?: BugRow[];
  // Les tables, et leurs sieges. Absentes, aucune histoire n'en porte.
  parties?: PartyRow[];
  partyMembers?: PartyMemberRow[];
  turns?: TurnRow[];
  // Absent, rien ne s'y ecrit : seuls les tests de canon le posent.
  canonFacts?: CanonFactRow[];
}

export interface PartyRow {
  id: string;
  universeId: string;
  size: number;
  inviteCode: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PartyMemberRow {
  id: string;
  partyId: string;
  userId: string;
  works: string[];
  ready: boolean;
  isHost: boolean;
  joinedAt: Date;
}

export interface CanonFactRow {
  id: string;
  universeId: string;
  memberId: string | null;
  subject: string;
  statement: string;
  seq: number;
  createdAt: Date;
}

export interface TurnRow {
  id: string;
  universeId: string;
  memberId: string | null;
  seq: number;
  request: string | null;
  die: number;
  band: string;
  modifier: number;
  attribute: string | null;
  usedDie: boolean;
  kind: string;
  learned: number;
  situation: string | null;
  guidance: string[];
  speaker: string | null;
  line: string | null;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  traceId: string | null;
  createdAt: Date;
}

export interface BugRow {
  id: string;
  userId: string | null;
  page: string;
  message: string;
  userAgent: string;
  screenshot: Uint8Array | null;
  screenshotType: string | null;
  handledAt: Date | null;
  createdAt: Date;
}

export interface SiteSettingsRow {
  id: true;
  alphaPhase: string;
  alphaNotice: boolean;
  salesOpen: boolean;
  updatedAt: Date;
}

const OPEN_SETTINGS: SiteSettingsRow = {
  id: true,
  alphaPhase: 'open',
  alphaNotice: false,
  salesOpen: false,
  updatedAt: new Date(0),
};

function matchMessages(store: OnboardingStore, where: any): MessageRow[] {
  return store.messages.filter(
    (row) =>
      row.universeId === where.universeId &&
      row.channel === where.channel &&
      (where.role === undefined || row.role === where.role) &&
      (where.memberId === undefined || row.memberId === where.memberId),
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

function messageMatches(row: MessageRow, where: any): boolean {
  return (
    row.universeId === where.universeId &&
    (where.channel === undefined || row.channel === where.channel) &&
    (where.role === undefined || row.role === where.role) &&
    (where.memberId === undefined || row.memberId === where.memberId)
  );
}

function entriesMatching(store: OnboardingStore, where: any): CreditEntryRow[] {
  return (store.creditEntries ?? []).filter((row) => {
    if (
      where?.subscriptionId !== undefined &&
      row.subscriptionId !== where.subscriptionId
    ) {
      return false;
    }
    if (typeof where?.reason === 'string' && row.reason !== where.reason)
      return false;
    if (where?.reason?.notIn?.includes(row.reason)) return false;
    if (where?.ref !== undefined) {
      const wanted = where.ref?.in ?? where.ref;
      if (
        Array.isArray(wanted) ? !wanted.includes(row.ref) : row.ref !== wanted
      ) {
        return false;
      }
    }
    if (where?.delta?.lt !== undefined && !(row.delta < where.delta.lt))
      return false;
    if (
      where?.createdAt?.gte !== undefined &&
      row.createdAt < where.createdAt.gte
    ) {
      return false;
    }
    if (
      where?.createdAt?.lte !== undefined &&
      row.createdAt > where.createdAt.lte
    ) {
      return false;
    }
    return true;
  });
}

function pickEntry(row: CreditEntryRow, select?: Record<string, boolean>) {
  return select
    ? Object.fromEntries(
        Object.keys(select).map((key) => [key, (row as any)[key]]),
      )
    : { ...row };
}

export function makeOnboardingPrisma(store: OnboardingStore) {
  // Les transactions interactives du double, une a la fois.
  let serial: Promise<unknown> = Promise.resolve();

  /*
    Les sieges d'une table, par ordre d'arrivee, le pseudo venu avec : c'est
    la forme que lisent le parcours et la vue du monde.
  */
  const membersOf = (partyId: string) =>
    (store.partyMembers ?? [])
      .filter((row) => row.partyId === partyId)
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
      .map((row) => ({
        ...row,
        user: {
          username:
            store.users.find((u) => u.id === row.userId)?.username ?? null,
        },
      }));

  const partyOf = (partyId: string) =>
    (store.parties ?? []).find((row) => row.id === partyId);

  /*
    Une universe, servie par include ou par select : les relations mentionnees
    dans l'un comme dans l'autre, les colonnes par leur nom.
  */
  const projectUniverse = (row: UniverseRow, include: any, select: any) => {
    if (!select) return hydrate(row, include);

    const hydrated = hydrate(row, {
      ...include,
      characters: select.characters ?? include?.characters,
      jobs: typeof select.jobs === 'object' ? select.jobs : include?.jobs,
      party: select.party ?? include?.party,
    }) as Record<string, unknown>;

    return Object.fromEntries(
      Object.keys(select).map((key) => [key, hydrated[key]]),
    );
  };

  /*
    La disjonction de l'histoire ouverte : la sienne, ou celle de sa table.
    Un seul membre suffit : l'unicite du siege est celle de la base.
  */
  const matchesOpenStory = (
    store: OnboardingStore,
    universe: UniverseRow,
    disjunction: any[],
  ) =>
    disjunction.some((branch) => {
      if (branch.ownerId !== undefined) return universe.ownerId === branch.ownerId;
      const userId = branch.party?.members?.some?.userId;
      return (store.partyMembers ?? []).some(
        (member) =>
          member.userId === userId &&
          partyOf(member.partyId)?.universeId === universe.id,
      );
    });

  const hydrate = (
    universe: UniverseRow | undefined,
    include?: {
      characters?: { where?: { ownerId?: string }; include?: unknown };
      jobs?: { take?: number };
      entities?: unknown;
      canon?: unknown;
      visiting?: unknown;
      party?: unknown;
    },
  ): any => {
    if (!universe) return null;
    if (!include) return { ...universe };

    const jobs = store.jobs
      .filter((job) => job.universeId === universe.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    /*
      Les fiches qu'on y incarne, filtres par proprietaire quand la lecture
      le demande : une fiche par joueur et par univers, et c'est le lecteur
      qui dit la sienne.
    */
    const characters = store.characters.filter(
      (row) =>
        row.universeId === universe.id &&
        (include.characters?.where?.ownerId === undefined ||
          row.ownerId === include.characters.where.ownerId),
    );

    const party =
      include.party === undefined
        ? undefined
        : ((store.parties ?? []).find((row) => row.universeId === universe.id) ??
          null);

    return {
      ...universe,
      characters: include.characters ? characters : undefined,
      jobs: include.jobs
        ? jobs.slice(0, include.jobs.take ?? jobs.length)
        : undefined,
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
      party:
        party === undefined
          ? undefined
          : party === null
            ? null
            : { ...party, members: membersOf(party.id) },
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
      Le canon n'est joue de bout en bout que si le test pose sa liste : il
      s'y ecrit alors, et se relit par univers.
    */
    canonFact: {
      findMany: async ({ where }: any = {}) =>
        (store.canonFacts ?? [])
          .filter((row) => !where?.universeId?.in || where.universeId.in.includes(row.universeId))
          .map((row) => ({ ...row })),
      create: async ({ data }: any) => {
        const row: CanonFactRow = {
          id: randomUUID(),
          memberId: null,
          createdAt: new Date(),
          ...data,
        };
        store.canonFacts?.push(row);
        return { ...row };
      },
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
          .filter(
            (row) =>
              where?.ownerId === undefined || row.ownerId === where.ownerId,
          )
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
          (row) =>
            where?.ownerId === undefined || row.ownerId === where.ownerId,
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
        const row = (store.essences ?? []).find(
          (item) => item.id === where.id,
        )!;
        return { ...assign(row, data) };
      },
      delete: async ({ where }: any) => {
        store.essences = (store.essences ?? []).filter(
          (row) => row.id !== where.id,
        );
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
          where.id
            ? user.id === where.id
            : user.keycloakId === where.keycloakId,
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
      /*
        Les regles de la base au depart d'un compte : SetNull sur ce qu'il a
        possede ou ecrit (mondes, personnages, messages, tours), cascade sur
        ce qui n'etait qu'a lui (essences, sieges, abonnement).
      */
      delete: async ({ where }: any) => {
        const row = store.users.find((user) => user.id === where.id)!;
        store.users = store.users.filter((user) => user.id !== where.id);
        for (const universe of store.universes) {
          if (universe.ownerId === where.id) universe.ownerId = null as any;
        }
        const essences = (store.essences ?? [])
          .filter((essence) => essence.ownerId === where.id)
          .map((essence) => essence.id);
        store.essences = (store.essences ?? []).filter(
          (essence) => essence.ownerId !== where.id,
        );
        for (const character of store.characters) {
          if (character.ownerId === where.id) character.ownerId = null as any;
          if (character.essenceId && essences.includes(character.essenceId))
            character.essenceId = null;
        }
        for (const message of store.messages) {
          if (message.memberId === where.id) message.memberId = null;
        }
        for (const turn of store.turns ?? []) {
          if (turn.memberId === where.id) turn.memberId = null;
        }
        for (const fact of store.canonFacts ?? []) {
          if (fact.memberId === where.id) fact.memberId = null;
        }
        store.partyMembers = (store.partyMembers ?? []).filter(
          (member) => member.userId !== where.id,
        );
        const subscriptions = (store.subscriptions ?? [])
          .filter((subscription) => subscription.userId === where.id)
          .map((subscription) => subscription.id);
        store.subscriptions = (store.subscriptions ?? []).filter(
          (subscription) => subscription.userId !== where.id,
        );
        store.creditEntries = (store.creditEntries ?? []).filter(
          (entry) => !subscriptions.includes(entry.subscriptionId),
        );
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
        return projectUniverse(row, include, select);
      },
      /*
        L'histoire ouverte, la sienne ou celle de sa table : la disjonction ne
        passe pas par le where etendu, et le double l'applique pareil.
      */
      findFirst: async ({ where, include, select }: any = {}) => {
        const row = store.universes.find(
          (universe) =>
            where?.id === undefined || universe.id === where.id,
        );
        if (!row) return null;
        if (where?.OR && !matchesOpenStory(store, row, where.OR)) return null;
        return projectUniverse(row, include, select);
      },
      findFirstOrThrow: async ({ where, include }: any = {}) => {
        const row = store.universes.find(
          (universe) => where?.id === undefined || universe.id === where.id,
        );
        if (!row) throw new Error('univers absent');
        return hydrate(row, include);
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
          .filter(
            (row) =>
              where?.ownerId === undefined || row.ownerId === where.ownerId,
          )
          // Les visites d'un monde : aucun test n'en joue, donc aucune ligne.
          .filter(
            () =>
              where?.visiting === undefined && where?.visitingId === undefined,
          )
          .sort(
            (a, b) =>
              (orderBy?.createdAt === 'desc' ? -1 : 1) *
              (a.createdAt.getTime() - b.createdAt.getTime()),
          );
        return rows.map((row) => projectUniverse(row, include, select));
      },
      count: async ({ where }: any = {}) =>
        store.universes.filter(
          (row) =>
            where?.ownerId === undefined || row.ownerId === where.ownerId,
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
        const row = store.universes.find(
          (universe) => universe.id === where.id,
        )!;
        assign(row, data);
        row.updatedAt = new Date();
        return hydrate(row, include);
      },
      // L'ecriture conditionnelle : ne touche que ce qui repond au filtre,
      // et dit combien de lignes ont bouge. C'est elle qui tranche les courses.
      updateMany: async ({ where, data }: any) => {
        const step = where?.step;
        const wanted = step?.in ?? step;
        const rows = store.universes.filter(
          (row) =>
            (where?.id === undefined || row.id === where.id) &&
            (step === undefined ||
              (Array.isArray(wanted)
                ? wanted.includes(row.step)
                : row.step === wanted)),
        );
        for (const row of rows) {
          assign(row, data);
          row.updatedAt = new Date();
        }
        return { count: rows.length };
      },
      // Cascade sur messages, travaux, rencontres et tables ; SetNull sur le
      // personnage et sur l'histoire ouverte des joueurs.
      delete: async ({ where }: any) => {
        store.universes = store.universes.filter((row) => row.id !== where.id);
        const gone = (store.parties ?? [])
          .filter((row) => row.universeId === where.id)
          .map((row) => row.id);
        store.parties = (store.parties ?? []).filter(
          (row) => row.universeId !== where.id,
        );
        store.partyMembers = (store.partyMembers ?? []).filter(
          (row) => !gone.includes(row.partyId),
        );
        for (const user of store.users) {
          if (user.currentUniverseId === where.id)
            user.currentUniverseId = null;
        }
        store.messages = store.messages.filter(
          (row) => row.universeId !== where.id,
        );
        store.jobs = store.jobs.filter((row) => row.universeId !== where.id);
        store.encounters = (store.encounters ?? []).filter(
          (row) => row.universeId !== where.id,
        );
        for (const character of store.characters) {
          if (character.universeId === where.id)
            character.universeId = null as any;
        }
        return {};
      },
    },

    character: {
      findUnique: async ({ where, select }: any) => {
        const row = store.characters.find((item) =>
          where.id
            ? item.id === where.id
            : where.universeId_ownerId
              ? item.universeId === where.universeId_ownerId.universeId &&
                item.ownerId === where.universeId_ownerId.ownerId
              : item.universeId === where.universeId,
        );
        if (!row) return null;
        if (!select) return { ...row };
        return Object.fromEntries(
          Object.keys(select).map((key) => [key, (row as any)[key]]),
        );
      },
      findMany: async ({ where, select }: any = {}) =>
        store.characters
          .filter((row) => {
            const universeId = where?.universeId;
            if (universeId === undefined) return true;
            if (typeof universeId === 'object') {
              return (
                universeId.not === undefined || row.universeId !== universeId.not
              );
            }
            return row.universeId === universeId;
          })
          // Le proprietaire : une valeur nue par egalite, `in` par
          // appartenance, `not: null` par presence.
          .filter((row) => {
            const ownerId = where?.ownerId;
            if (ownerId === undefined) return true;
            if (typeof ownerId !== 'object') return row.ownerId === ownerId;
            if (ownerId.in !== undefined) return ownerId.in.includes(row.ownerId);
            if (ownerId.not === null) return row.ownerId !== null;
            return true;
          })
          .filter((row) =>
            where?.essenceId === undefined || row.essenceId === where.essenceId,
          )
          .map((row) =>
            select
              ? Object.fromEntries(
                  Object.keys(select).map((key) => [key, (row as any)[key]]),
                )
              : { ...row },
          ),
      update: async ({ where, data }: any) => {
        const row = store.characters.find((item) =>
          where.id
            ? item.id === where.id
            : where.universeId_ownerId
              ? item.universeId === where.universeId_ownerId.universeId &&
                item.ownerId === where.universeId_ownerId.ownerId
              : item.universeId === where.universeId,
        )!;
        return { ...assign(row, data) };
      },
      delete: async ({ where }: any) => {
        store.characters = store.characters.filter(
          (row) => row.id !== where.id,
        );
        store.encounters = (store.encounters ?? []).filter(
          (row) => row.characterId !== where.id,
        );
        return {};
      },
      deleteMany: async ({ where }: any) => {
        const kept = store.characters.filter(
          (row) =>
            !(
              row.universeId === where.universeId &&
              (where.ownerId === undefined || row.ownerId === where.ownerId)
            ),
        );
        const count = store.characters.length - kept.length;
        store.characters = kept;
        return { count };
      },
      count: async ({ where }: any = {}) =>
        store.characters.filter(
          (row) =>
            (where?.essenceId === undefined || row.essenceId === where.essenceId) &&
            (where?.universeId === undefined || row.universeId === where.universeId),
        ).length,
      upsert: async ({ where, create, update }: any) => {
        const target = where.universeId_ownerId ?? where;
        const existing = store.characters.find(
          (row) =>
            row.universeId === target.universeId &&
            row.ownerId === target.ownerId,
        );
        if (existing) return { ...assign(existing, update) };

        const now = new Date();
        const row: CharacterRow = {
          id: randomUUID(),
          universeId: target.universeId,
          ownerId: target.ownerId,
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
          if (
            where.universeId !== undefined &&
            row.universeId !== where.universeId
          ) {
            return false;
          }
          if (
            where.characterId !== undefined &&
            row.characterId !== where.characterId
          ) {
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
          memberId: data.memberId ?? null,
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
      /*
        Le canal et le membre filtrent aussi : sans eux, effacer le fil de
        creation d'un partant effacait tout le journal du jeu, et aucun test
        ne pouvait voir ce qui en restait.
      */
      deleteMany: async ({ where }: any) => {
        const kept = store.messages.filter((row) => !messageMatches(row, where));
        const count = store.messages.length - kept.length;
        store.messages = kept;
        return { count };
      },
      updateMany: async ({ where, data }: any) => {
        const rows = store.messages.filter((row) => messageMatches(row, where));
        for (const row of rows) assign(row, data);
        return { count: rows.length };
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
              (where?.universeId === undefined ||
                row.universeId === where.universeId) &&
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
        const kept = store.jobs.filter(
          (row) => row.universeId !== where.universeId,
        );
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

    /*
      Les tables et leurs sieges, assez fideles pour jouer l'entree en jeu
      d'un groupe : l'unicite du siege est celle de la base, le code
      d'invitation l'universalite de la sienne.
    */
    party: {
      // Cascade sur les sieges, comme en base.
      deleteMany: async ({ where }: any) => {
        const gone = (store.parties ?? [])
          .filter((row) => row.id === where.id)
          .map((row) => row.id);
        store.parties = (store.parties ?? []).filter((row) => !gone.includes(row.id));
        store.partyMembers = (store.partyMembers ?? []).filter(
          (row) => !gone.includes(row.partyId),
        );
        return { count: gone.length };
      },
      findUnique: async ({ where, include, select }: any) => {
        const row = (store.parties ?? []).find(
          (party) =>
            (where.id !== undefined ? party.id === where.id : true) &&
            (where.universeId !== undefined
              ? party.universeId === where.universeId
              : true) &&
            (where.inviteCode !== undefined
              ? party.inviteCode === where.inviteCode
              : true),
        );
        if (!row) return null;
        const members =
          include?.members || select?.members
            ? membersOf(row.id)
            : undefined;
        const universe =
          include?.universe || select?.universe
            ? (store.universes.find((u) => u.id === row.universeId) ?? null)
            : undefined;
        if (!select) return { ...row, ...(members ? { members } : {}), ...(universe ? { universe } : {}) };
        return Object.fromEntries(
          Object.keys(select).map((key) =>
            key === 'members'
              ? [key, members]
              : key === 'universe'
                ? [key, universe]
                : [key, (row as any)[key]],
          ),
        );
      },
      findUniqueOrThrow: async ({ where, include, select }: any) => {
        const row = (store.parties ?? []).find((party) => party.id === where.id);
        if (!row) throw new Error('table absente');
        const members =
          include?.members || select?.members ? membersOf(row.id) : undefined;
        if (!select) {
          return {
            ...row,
            ...(members !== undefined ? { members } : {}),
          };
        }
        return Object.fromEntries(
          Object.keys(select).map((key) =>
            key === 'members' ? [key, members] : [key, (row as any)[key]],
          ),
        );
      },
      create: async ({ data, include }: any) => {
        const now = new Date();
        const row: PartyRow = {
          id: randomUUID(),
          universeId: data.universeId,
          size: data.size,
          inviteCode: data.inviteCode,
          createdAt: now,
          updatedAt: now,
        };
        store.parties = [...(store.parties ?? []), row];

        if (data.members?.create) {
          const seat = data.members.create;
          store.partyMembers = [
            ...(store.partyMembers ?? []),
            {
              id: randomUUID(),
              partyId: row.id,
              userId: seat.userId,
              works: [],
              ready: false,
              isHost: seat.isHost ?? false,
              joinedAt: now,
            },
          ];
        }

        if (!include) return { ...row };
        return {
          ...row,
          members: include.members ? membersOf(row.id) : undefined,
        };
      },
    },

    partyMember: {
      findUnique: async ({ where, select }: any) => {
        const row = (store.partyMembers ?? []).find(
          (member) => member.userId === where.userId,
        );
        if (!row) return null;
        const party = partyOf(row.partyId);
        if (!select) return { ...row, party };
        return Object.fromEntries(
          Object.keys(select).map((key) =>
            key === 'party' ? [key, party] : [key, (row as any)[key]],
          ),
        );
      },
      findMany: async ({ where }: any = {}) =>
        (store.partyMembers ?? [])
          .filter(
            (row) => where?.userId === undefined || row.userId === where.userId,
          )
          .map((row) => ({ ...row })),
      create: async ({ data }: any) => {
        const row: PartyMemberRow = {
          id: randomUUID(),
          partyId: data.partyId,
          userId: data.userId,
          works: [],
          ready: false,
          isHost: false,
          joinedAt: new Date(),
        };
        store.partyMembers = [...(store.partyMembers ?? []), row];
        return { ...row };
      },
      update: async ({ where, data }: any) => {
        const row = (store.partyMembers ?? []).find(
          (member) => member.userId === where.userId,
        )!;
        return { ...assign(row, data) };
      },
      updateMany: async ({ where, data }: any) => {
        const rows = (store.partyMembers ?? []).filter(
          (row) =>
            (where?.userId === undefined || row.userId === where.userId) &&
            (where?.partyId === undefined || row.partyId === where.partyId) &&
            (where?.ready === undefined || row.ready === where.ready),
        );
        for (const row of rows) assign(row, data);
        return { count: rows.length };
      },
      deleteMany: async ({ where }: any) => {
        const kept = (store.partyMembers ?? []).filter(
          (row) =>
            !(
              (where?.partyId === undefined || row.partyId === where.partyId) &&
              (where?.userId === undefined || row.userId === where.userId)
            ),
        );
        const count = (store.partyMembers ?? []).length - kept.length;
        store.partyMembers = kept;
        return { count };
      },
    },

    // Le tour de jeu : aucun e2e ne le joue au-dela de son ecriture.
    turn: {
      findMany: async ({ where }: any = {}) =>
        (store.turns ?? [])
          .filter(
            (row) =>
              (where?.universeId === undefined ||
                row.universeId === where.universeId) &&
              (where?.memberId === undefined || row.memberId === where.memberId),
          )
          .map((row) => ({ ...row })),
      findFirst: async ({ where, orderBy, select }: any = {}) => {
        const rows = (store.turns ?? [])
          .filter(
            (row) =>
              (where?.universeId === undefined ||
                row.universeId === where.universeId) &&
              (where?.memberId === undefined || row.memberId === where.memberId) &&
              (where?.request === undefined || row.request === where.request),
          )
          .sort((a, b) =>
            orderBy?.seq === 'desc' ? b.seq - a.seq : a.seq - b.seq,
          );
        const row = rows[0];
        if (!row) return null;
        if (!select) return { ...row };
        return Object.fromEntries(
          Object.keys(select).map((key) => [key, (row as any)[key]]),
        );
      },
      count: async ({ where }: any = {}) =>
        (store.turns ?? []).filter(
          (row) =>
            (where?.universeId === undefined ||
              row.universeId === where.universeId) &&
            (where?.memberId === undefined || row.memberId === where.memberId),
        ).length,
      create: async ({ data }: any) => {
        const row: TurnRow = {
          id: randomUUID(),
          universeId: data.universeId,
          memberId: data.memberId ?? null,
          seq: data.seq,
          request: data.request ?? null,
          die: data.die,
          band: data.band,
          modifier: data.modifier ?? 0,
          attribute: data.attribute ?? null,
          usedDie: data.usedDie ?? false,
          kind: data.kind ?? 'action',
          learned: data.learned ?? 0,
          situation: data.situation ?? null,
          guidance: data.guidance ?? [],
          speaker: data.speaker ?? null,
          line: data.line ?? null,
          provider: data.provider ?? null,
          model: data.model ?? null,
          inputTokens: data.inputTokens ?? null,
          outputTokens: data.outputTokens ?? null,
          costUsd: data.costUsd ?? null,
          traceId: data.traceId ?? null,
          createdAt: new Date(),
        };
        store.turns = [...(store.turns ?? []), row];
        return { ...row };
      },
    },

    /*
      Les deux formes : la liste d'ecritures, et la callback qui recoit le
      double. La liste se joue dans l'ordre, comme une transaction.

      La callback qui jette defait ce qu'elle avait ecrit, comme la base :
      sans cela, un remboursement refuse par l'index laissait son solde
      credite. Les callbacks passent une a une, comme deux transactions qui
      se heurtent sur la meme ligne ou le meme index : sans cela, celle qui
      echoue restaurerait un etat anterieur a celle qui a reussi.
    */
    $transaction: async (run: any) => {
      if (Array.isArray(run)) return Promise.all(run);
      const turn = serial.then(async () => {
        const before = structuredClone(store);
        try {
          return await run(double);
        } catch (error: unknown) {
          for (const key of Object.keys(store)) delete (store as any)[key];
          Object.assign(store, before);
          throw error;
        }
      });
      serial = turn.catch(() => undefined);
      return turn;
    },

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
      // Le grand livre repond a « lequel reste-t-il a rendre » et a « ce que
      // la reserve contenait au depart ».
      findMany: async ({ where, select }: any = {}) =>
        entriesMatching(store, where).map((row) => pickEntry(row, select)),
      findFirst: async ({ where, orderBy, select }: any = {}) => {
        const rows = entriesMatching(store, where);
        if (orderBy?.createdAt === 'desc') rows.reverse();
        return rows[0] ? pickEntry(rows[0], select) : null;
      },
      aggregate: async ({ where }: any = {}) => {
        const rows = entriesMatching(store, where);
        return {
          _sum: {
            delta: rows.length
              ? rows.reduce((sum, row) => sum + row.delta, 0)
              : null,
          },
        };
      },
      create: async ({ data }: any) => {
        /*
          L'index partiel `credit_entries_refund_ref_key`, reproduit : un
          debit ne se rembourse qu'une fois, et la base le refuse avec la
          meme erreur que Prisma.
        */
        if (
          data.reason === 'refund' &&
          (store.creditEntries ?? []).some(
            (row) => row.reason === 'refund' && row.ref === data.ref,
          )
        ) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'double',
          });
        }
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
    bugReport: {
      create: async ({ data }: any) => {
        const row: BugRow = {
          id: randomUUID(),
          userId: data.userId ?? null,
          page: data.page,
          message: data.message,
          userAgent: data.userAgent,
          screenshot: data.screenshot ?? null,
          screenshotType: data.screenshotType ?? null,
          handledAt: null,
          createdAt: new Date(),
        };
        (store.bugs ??= []).push(row);
        return { ...row };
      },
    },

    siteSettings: {
      findFirst: async () => ({ ...(store.siteSettings ?? OPEN_SETTINGS) }),
      upsert: async () => ({ ...(store.siteSettings ?? OPEN_SETTINGS) }),
      update: async ({ data }: any) => {
        store.siteSettings = {
          ...(store.siteSettings ?? OPEN_SETTINGS),
          ...data,
        };
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
            where?.stripePriceId?.not === null
              ? row.stripePriceId !== null
              : true,
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
