import { describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@odyssai/db';
import {
  CREDIT_COSTS,
  FOUNDER_BONUS,
  FREE_PLAN_SLUG,
  PLAN_LIMITS,
  creditsFor,
  nextPeriod,
} from '@odyssai/engine';
import { CreditsService, OutOfCreditsError } from './credits.service.js';
import type { PlansService } from '../plans/plans.service.js';
import { makeOnboardingPrisma, type OnboardingStore } from '../onboarding/testing/doubles.js';

describe('bareme', () => {
  it('prend le tour pour unite', () => {
    expect(creditsFor('turn')).toBe(1);
  });

  // Faire payer au joueur le fait qu'on le surveille serait indefendable.
  it('ne facture pas ce qui n est pas un service rendu', () => {
    expect(creditsFor('characterExtract')).toBe(0);
  });

  it('fait payer un monde a la hauteur de ce qu il coute', () => {
    expect(CREDIT_COSTS.worldGeneration).toBeGreaterThanOrEqual(
      CREDIT_COSTS.turn * 7,
    );
  });

  /*
    Les paliers vivent en base depuis le tableau de bord d'administration ;
    seul le slug du palier offert reste une constante, parce que c'est celui
    sur lequel un abonnement resilie retombe.
  */
  it('garde le slug du palier offert en code', () => {
    expect(FREE_PLAN_SLUG).toBe('free');
  });

  // Une dotation negative rendrait un solde negatif, une dotation demesuree
  // viderait le budget sans qu'aucune limite ne s'y oppose.
  it('borne ce qu un palier peut valoir', () => {
    expect(PLAN_LIMITS.monthlyCreditsMax).toBeGreaterThan(
      CREDIT_COSTS.worldGeneration,
    );
    // Sous cinquante centimes, les frais fixes de Stripe mangent tout.
    expect(PLAN_LIMITS.amountCentsMin).toBeGreaterThanOrEqual(50);
  });
});

describe('ancrage des periodes', () => {
  it('avance d un mois', () => {
    expect(nextPeriod(new Date('2026-01-20T10:00:00Z')).toISOString()).toBe(
      '2026-02-20T10:00:00.000Z',
    );
  });

  /*
    Le piege de `setMonth` : le 31 janvier plus un mois donne le 3 mars, parce
    que fevrier n'a pas de 31. Un abonne du 31 doit rester au dernier jour.
  */
  it('ne deborde pas sur le mois suivant', () => {
    expect(nextPeriod(new Date('2026-01-31T10:00:00Z')).toISOString()).toBe(
      '2026-02-28T10:00:00.000Z',
    );
    expect(nextPeriod(new Date('2026-03-31T10:00:00Z')).toISOString()).toBe(
      '2026-04-30T10:00:00.000Z',
    );
  });

  it('tient une annee bissextile', () => {
    expect(nextPeriod(new Date('2028-01-31T10:00:00Z')).toISOString()).toBe(
      '2028-02-29T10:00:00.000Z',
    );
  });

  it('passe une fin d annee', () => {
    expect(nextPeriod(new Date('2026-12-15T10:00:00Z')).toISOString()).toBe(
      '2027-01-15T10:00:00.000Z',
    );
  });
});

/*
  Le bonus des premiers arrives.

  La regle tient en deux phrases et se casse en silence : un administrateur y
  a droit sans occuper une des cent places, et la centieme place se compte sur
  les inscriptions anterieures, pas sur un compteur. Un test parce qu'une
  erreur ici ne se verrait qu'au centieme joueur.
*/
describe('bonus des cent premiers', () => {
  const plan = { slug: FREE_PLAN_SLUG, monthlyCredits: 0, welcomeCredits: 50 };

  function serviceFor(user: { isAdmin: boolean }, before: number) {
    const created: { credits?: number } = {};
    const entries: { delta: number; reason: string }[] = [];

    const prisma = {
      subscription: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(({ data }: { data: { credits: number } }) => {
          created.credits = data.credits;
          return Promise.resolve({ id: 's1', ...data });
        }),
      },
      creditEntry: {
        create: vi.fn(
          ({ data }: { data: { delta: number; reason: string } }) => {
            entries.push(data);
            return Promise.resolve(data);
          },
        ),
      },
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ ...user, createdAt: new Date() }),
        count: vi.fn().mockResolvedValue(before),
      },
    };

    const plans = { free: vi.fn().mockResolvedValue(plan) };
    const service = new CreditsService(
      prisma as unknown as PrismaClient,
      plans as unknown as PlansService,
    );

    return { service, created, entries };
  }

  it('ajoute le bonus a un joueur parmi les cent premiers', async () => {
    const { service, created, entries } = serviceFor({ isAdmin: false }, 99);
    await service.ensure('u1');

    expect(created.credits).toBe(plan.welcomeCredits + FOUNDER_BONUS.credits);
    // Deux ecritures : le grand livre doit dire pourquoi, pas seulement combien.
    expect(entries.map((entry) => entry.reason)).toEqual([
      'welcome',
      'founder',
    ]);
  });

  it('ne donne rien au cent unieme', async () => {
    const { service, created, entries } = serviceFor({ isAdmin: false }, 100);
    await service.ensure('u1');

    expect(created.credits).toBe(plan.welcomeCredits);
    expect(entries.map((entry) => entry.reason)).toEqual(['welcome']);
  });

  // Sa reserve n'est jamais debitee : trente credits de plus ne changeraient
  // rien et prendraient la place d'un joueur.
  it('ne le donne pas a un administrateur', async () => {
    const { service, created } = serviceFor({ isAdmin: true }, 0);
    await service.ensure('u1');

    expect(created.credits).toBe(plan.welcomeCredits);
  });
});

/*
  Un administrateur joue sans limite.

  Ce que ses parties coutent reste compte par `llm_usage` : c'est la reserve
  qui ne bouge pas, pas la comptabilite.
*/
describe('reserve illimitee', () => {
  function serviceFor(isAdmin: boolean, credits: number) {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ isAdmin }) },
      subscription: {
        findUnique: vi.fn().mockResolvedValue({
          id: 's1',
          plan: FREE_PLAN_SLUG,
          status: 'active',
          credits,
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 86_400_000),
        }),
      },
      $transaction: vi.fn(),
    };

    return new CreditsService(
      prisma as unknown as PrismaClient,
      { free: vi.fn() } as unknown as PlansService,
    );
  }

  it('ne debite rien pour un administrateur, meme a zero', async () => {
    const service = serviceFor(true, 0);

    // Aucune ecriture, donc rien a rembourser : l'appelant recoit null, comme
    // pour une action gratuite.
    await expect(service.spend('turn', 'u1')).resolves.toBeNull();
  });

  it('refuse un joueur ordinaire dont la reserve est vide', async () => {
    const service = serviceFor(false, 0);

    await expect(service.spend('turn', 'u1')).rejects.toThrow(
      OutOfCreditsError,
    );
  });
});

/*
  Le roulement de periode.

  La regle « les credits ne se reportent pas » borne un abonne qui en recoit
  de nouveaux. Appliquee telle quelle a un palier sans dotation, elle
  confisquait une reserve offerte que rien ne remplacait : quelqu'un qui
  s'inscrit et ne joue pas perdait tout au bout d'un mois.
*/
describe('roulement de periode', () => {
  function serviceFor(plan: { monthlyCredits: number }, credits: number) {
    const passed = new Date(Date.now() - 40 * 24 * 3600 * 1000);
    const state: { credits?: number } = {};
    const entries: { delta: number; reason: string }[] = [];

    const tx = {
      subscription: {
        update: vi.fn(({ data }: { data: { credits: number } }) => {
          state.credits = data.credits;
          return Promise.resolve({ id: 's1', ...data });
        }),
      },
      creditEntry: {
        create: vi.fn(
          ({ data }: { data: { delta: number; reason: string } }) => {
            entries.push(data);
            return Promise.resolve(data);
          },
        ),
      },
    };

    const prisma = {
      subscription: {
        findUnique: vi.fn().mockResolvedValue({
          id: 's1',
          plan: FREE_PLAN_SLUG,
          status: 'active',
          credits,
          periodStart: passed,
          periodEnd: passed,
        }),
      },
      $transaction: vi.fn((run: (client: typeof tx) => unknown) => run(tx)),
    };

    const plans = {
      free: vi.fn().mockResolvedValue({ slug: FREE_PLAN_SLUG, ...plan }),
      bySlug: vi.fn().mockResolvedValue({ slug: FREE_PLAN_SLUG, ...plan }),
    };

    const service = new CreditsService(
      prisma as unknown as PrismaClient,
      plans as unknown as PlansService,
    );

    return { service, state, entries };
  }

  it('remet un abonnement paye a sa dotation, sans report', async () => {
    const { service, state, entries } = serviceFor({ monthlyCredits: 300 }, 12);
    await service.ensure('u1');

    expect(state.credits).toBe(300);
    expect(entries[0]?.reason).toBe('grant');
  });

  it('laisse sa reserve a un palier qui ne reverse rien', async () => {
    const { service, state, entries } = serviceFor({ monthlyCredits: 0 }, 43);
    await service.ensure('u1');

    expect(state.credits).toBe(43);
    // Rien n'a bouge : le grand livre raconte des mouvements, pas des dates.
    expect(entries).toHaveLength(0);
  });
});

/*
  Apres une resiliation chez Stripe : la ligne retombe au palier libre en
  `canceled` sans toucher a la reserve, et le roulement suivant ne verse ni ne
  reprend rien. Ce qui a ete paye ne s'evapore pas.
*/
describe('apres une resiliation', () => {
  it('garde les credits et n en verse plus', async () => {
    const passed = new Date(Date.now() - 40 * 24 * 3600 * 1000);
    const state: { credits?: number; plan?: string } = {};
    const entries: unknown[] = [];

    const tx = {
      subscription: {
        update: vi.fn(
          ({ data }: { data: { credits: number; plan: string } }) => {
            state.credits = data.credits;
            state.plan = data.plan;
            return Promise.resolve({ id: 's1', ...data });
          },
        ),
      },
      creditEntry: {
        create: vi.fn((data: unknown) => {
          entries.push(data);
          return Promise.resolve(data);
        }),
      },
    };

    const prisma = {
      subscription: {
        findUnique: vi.fn().mockResolvedValue({
          id: 's1',
          plan: FREE_PLAN_SLUG,
          status: 'canceled',
          credits: 412,
          periodStart: passed,
          periodEnd: passed,
        }),
      },
      $transaction: vi.fn((run: (client: typeof tx) => unknown) => run(tx)),
    };

    const plans = {
      free: vi.fn().mockResolvedValue({
        slug: FREE_PLAN_SLUG,
        monthlyCredits: 0,
        welcomeCredits: 50,
      }),
      bySlug: vi.fn(),
    };

    const service = new CreditsService(
      prisma as unknown as PrismaClient,
      plans as unknown as PlansService,
    );

    await service.ensure('u1');

    expect(state.credits).toBe(412);
    expect(state.plan).toBe(FREE_PLAN_SLUG);
    // La bienvenue ne se rejoue pas non plus : elle appartient a l'ouverture
    // du compte, pas au retour au palier libre.
    expect(entries).toHaveLength(0);
    // Un abonnement resilie ne relit pas son ancien palier.
    expect(plans.bySlug).not.toHaveBeenCalled();
  });
});

/*
  Deux requetes du meme joueur qui ouvrent sa reserve en meme temps.

  L'ecran de compte lit sa reserve pendant que la page de tarifs lit son
  palier : les deux voient une ligne absente, les deux l'ouvrent, et
  `subscriptions.user_id` etant unique, l'une des deux perdait en cinq cents.
*/
describe('ouverture concurrente', () => {
  it('relit la ligne plutot que d echouer', async () => {
    const existing = { id: 's1', plan: FREE_PLAN_SLUG, credits: 50 };

    const conflict = Object.assign(new Error('duplicate'), {
      code: 'P2002',
    });
    Object.setPrototypeOf(
      conflict,
      Prisma.PrismaClientKnownRequestError.prototype,
    );

    const prisma = {
      subscription: {
        findUnique: vi
          .fn()
          // La lecture d'ouverture ne voit rien, celle du rattrapage voit la
          // ligne que l'autre requete vient d'ecrire.
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(existing),
        create: vi.fn().mockRejectedValue(conflict),
      },
      creditEntry: { create: vi.fn() },
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ isAdmin: false, createdAt: new Date() }),
        count: vi.fn().mockResolvedValue(0),
      },
    };

    const plans = {
      free: vi.fn().mockResolvedValue({
        slug: FREE_PLAN_SLUG,
        monthlyCredits: 0,
        welcomeCredits: 50,
      }),
    };

    const service = new CreditsService(
      prisma as unknown as PrismaClient,
      plans as unknown as PlansService,
    );

    await expect(service.ensure('u1')).resolves.toEqual(existing);
    // Rien n'est credite deux fois : la bienvenue appartient a la ligne creee.
    expect(prisma.creditEntry.create).not.toHaveBeenCalled();
  });
});

describe('ce que la reserve contenait au depart', () => {
  function serviceWith(
    reset: { createdAt: Date } | null,
    consumed: number | null,
  ) {
    const prisma = {
      creditEntry: {
        findFirst: vi.fn().mockResolvedValue(reset),
        aggregate: vi.fn().mockResolvedValue({ _sum: { delta: consumed } }),
      },
    };
    const service = new CreditsService(
      prisma as unknown as PrismaClient,
      {} as unknown as PlansService,
    );

    return { prisma, service };
  }

  it('rend le solde plus ce que le jeu a consomme', async () => {
    const { service } = serviceWith(null, -33);
    await expect(service.granted({ id: 's1', credits: 47 })).resolves.toBe(80);
  });

  it('vaut le solde quand rien n a ete consomme', async () => {
    const { service } = serviceWith(null, null);
    await expect(service.granted({ id: 's1', credits: 80 })).resolves.toBe(80);
  });

  // Une remise a la dotation est un nouveau depart : ce qui a ete consomme
  // avant appartient a la periode d'avant.
  it('ne compte que depuis la derniere remise a la dotation', async () => {
    const at = new Date('2026-09-01T00:00:00Z');
    const { prisma, service } = serviceWith({ createdAt: at }, -5);

    await expect(service.granted({ id: 's1', credits: 25 })).resolves.toBe(30);
    expect(prisma.creditEntry.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: at },
          reason: {
            notIn: expect.arrayContaining([
              'welcome',
              'founder',
              'grant',
              'adjustment',
            ]),
          },
        }),
      }),
    );
  });

  it('ne descend jamais sous le solde', async () => {
    const { service } = serviceWith(null, 3);
    await expect(service.granted({ id: 's1', credits: 10 })).resolves.toBe(10);
  });
});

/*
  Un debit ne se rembourse qu'une fois. Deux chemins qui le lisent chacun
  comme non rendu arrivent ensemble jusqu'ici : l'index partiel refuse le
  second, et sa transaction emporte l'increment du solde avec elle.
*/
describe('remboursement unique', () => {
  function ledger(): OnboardingStore {
    return {
      users: [],
      universes: [],
      characters: [],
      messages: [],
      jobs: [],
      subscriptions: [
        {
          id: 's1',
          userId: 'u1',
          plan: FREE_PLAN_SLUG,
          status: 'active',
          credits: 37,
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 86_400_000),
          welcomed: true,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          cancelAtPeriodEnd: false,
        },
      ],
      creditEntries: [
        {
          id: 'debit-1',
          subscriptionId: 's1',
          delta: -13,
          reason: 'worldGeneration',
          ref: 'univers-1',
          balance: 37,
          createdAt: new Date(),
        },
      ],
    };
  }

  it('ne rend qu une fois deux remboursements simultanes du meme debit', async () => {
    const store = ledger();
    const service = new CreditsService(
      makeOnboardingPrisma(store) as unknown as PrismaClient,
      {} as PlansService,
    );

    await Promise.all([service.refund('debit-1'), service.refund('debit-1')]);

    const refunds = store.creditEntries!.filter((row) => row.reason === 'refund');
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ ref: 'debit-1', delta: 13, balance: 50 });
    expect(store.subscriptions![0]!.credits).toBe(50);
  });

  it('ne rend rien de plus a un second remboursement tardif', async () => {
    const store = ledger();
    const service = new CreditsService(
      makeOnboardingPrisma(store) as unknown as PrismaClient,
      {} as PlansService,
    );

    await service.refund('debit-1');
    await expect(service.refund('debit-1')).resolves.toBeUndefined();

    expect(store.creditEntries!.filter((row) => row.reason === 'refund')).toHaveLength(1);
    expect(store.subscriptions![0]!.credits).toBe(50);
  });
});
