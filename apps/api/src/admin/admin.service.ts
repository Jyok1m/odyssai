import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient, type Subscription, type User } from '@odyssai/db';
import { FREE_PLAN_SLUG } from '@odyssai/engine';
import type {
  AdjustCreditsRequest,
  AdminOverview,
  AdminUserDetail,
  AdminUserPage,
  AdminUserRow,
} from '@odyssai/schemas';
import { BillingConfig } from '../config/billing-config.js';
import { CreditsService } from '../credits/credits.service.js';
import { PlansService } from '../plans/plans.service.js';
import { PRISMA } from '../prisma/prisma.module.js';

/** Ce que la liste rend d'un coup. Assez pour un ecran, assez peu pour une requete. */
const PAGE_SIZE = 50;

/** Trente jours, la fenetre des chiffres de la page d'accueil. */
const WINDOW_DAYS = 30;

export class UserNotFoundError extends Error {
  constructor(id: string) {
    super(`joueur introuvable : ${id}`);
    this.name = 'UserNotFoundError';
  }
}

/**
 * Les lectures et les ecritures du tableau de bord.
 *
 * Ce service voit tout, donc il n'est joignable que derriere `AdminGuard`. Il
 * n'expose aucune methode qui accorde le droit d'administrer : celui-la se
 * pose en base, a la main.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly plans: PlansService,
    private readonly credits: CreditsService,
    private readonly billing: BillingConfig,
  ) {}

  async overview(): Promise<AdminOverview> {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const plans = await this.plans.all(true);

    const [users, usersWithUsername, worlds, turns, subscriptions, spent] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { username: { not: null } } }),
        this.prisma.universe.count(),
        this.prisma.turn.count({ where: { createdAt: { gte: since } } }),
        this.prisma.subscription.findMany({
          select: { plan: true, credits: true, status: true },
        }),
        this.prisma.llmUsage.aggregate({
          _sum: { costUsd: true },
          where: { createdAt: { gte: since } },
        }),
      ]);

    const counted = new Map<string, number>();
    for (const row of subscriptions) {
      counted.set(row.plan, (counted.get(row.plan) ?? 0) + 1);
    }

    return {
      users,
      usersWithUsername,
      // Payant veut dire : sur un palier qui n'est pas le palier offert, et
      // dont l'abonnement tient encore.
      paying: subscriptions.filter(
        (row) => row.plan !== FREE_PLAN_SLUG && row.status === 'active',
      ).length,
      worlds,
      turnsLast30Days: turns,
      creditsOutstanding: subscriptions.reduce((sum, row) => sum + row.credits, 0),
      spentUsdLast30Days: Number(spent._sum.costUsd ?? 0),
      byPlan: plans.map((plan) => ({
        plan: plan.slug,
        planName: plan.name,
        subscribers: counted.get(plan.slug) ?? 0,
      })),
      stripeEnabled: this.billing.enabled,
      stripeLive: this.billing.live,
    };
  }

  /**
   * La liste des joueurs, filtrable sur le pseudo ou l'adresse.
   *
   * Pagination par curseur : la liste s'allonge pendant qu'on la lit, et un
   * decalage par numero de page ferait sauter ou repeter des lignes. L'`id`
   * etant un uuid v7, l'ordre decroissant donne les derniers arrives d'abord
   * et le curseur est simplement le dernier identifiant servi.
   */
  async users(query: {
    search?: string;
    plan?: string;
    cursor?: string;
  }): Promise<AdminUserPage> {
    const search = query.search?.trim();

    const where: Prisma.UserWhereInput = {
      ...(search
        ? {
            OR: [
              { username: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.plan ? { subscription: { plan: query.plan } } : {}),
    };

    const rows = await this.prisma.user.findMany({
      where,
      include: { subscription: true },
      orderBy: { id: 'desc' },
      take: PAGE_SIZE + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const page = rows.slice(0, PAGE_SIZE);
    const plans = await this.plans.all(true);

    return {
      rows: page.map((row) => this.toRow(row, row.subscription, plans)),
      // Rendu seulement s'il reste vraiment quelque chose : un curseur servi a
      // vide ferait boucler l'ecran sur une page toujours vide.
      nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async user(id: string): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new UserNotFoundError(id);

    // `ensure` plutot qu'une lecture : un joueur qui ne s'est jamais connecte
    // depuis la mise en place des credits n'a pas encore d'abonnement, et
    // l'ecran doit montrer sa reserve, pas un vide.
    const subscription = await this.credits.ensure(id);
    const plans = await this.plans.all(true);

    const [entries, spent, worldCount, turnCount] = await Promise.all([
      this.prisma.creditEntry.findMany({
        where: { subscriptionId: subscription.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.llmUsage.aggregate({
        _sum: { costUsd: true },
        where: { userId: id },
      }),
      this.prisma.universe.count({ where: { ownerId: id } }),
      this.prisma.turn.count({ where: { universe: { ownerId: id } } }),
    ]);

    return {
      ...this.toRow(user, subscription, plans),
      entries: entries.map((entry) => ({
        id: entry.id,
        delta: entry.delta,
        reason: entry.reason,
        ref: entry.ref,
        balance: entry.balance,
        createdAt: entry.createdAt.toISOString(),
      })),
      spentUsd: Number(spent._sum.costUsd ?? 0),
      worldCount,
      turnCount,
    };
  }

  /**
   * Pose ou deplace la reserve d'un joueur.
   *
   * L'ecriture passe par le grand livre et non par un `update` direct : il est
   * en ajout seul, et un solde remis a zero doit s'y lire comme un mouvement
   * date et motive, pas comme un trou inexplique. `note` est obligatoire pour
   * cette raison.
   */
  async adjustCredits(
    id: string,
    request: AdjustCreditsRequest,
    by: User,
  ): Promise<AdminUserDetail> {
    const subscription = await this.credits.ensure(id);

    const target =
      request.mode === 'set'
        ? request.credits
        : subscription.credits + request.credits;

    // Un solde negatif n'a pas de sens : la depense refuse deja a zero.
    const bounded = Math.max(0, target);
    const delta = bounded - subscription.credits;

    if (delta !== 0) {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.subscription.update({
          where: { id: subscription.id },
          data: { credits: bounded },
        });

        await tx.creditEntry.create({
          data: {
            subscriptionId: subscription.id,
            delta,
            reason: 'adjustment',
            // Qui a fait quoi, et pourquoi. L'identifiant plutot que
            // l'adresse : le grand livre n'a pas a porter d'e-mail.
            ref: `${by.id} ${request.note}`.slice(0, 255),
            balance: updated.credits,
          },
        });
      });

      this.logger.log(
        `reserve ajustee de ${delta} pour ${id}, par ${by.id} : ${request.note}`,
      );
    }

    return this.user(id);
  }

  private toRow(
    user: User,
    subscription: Subscription | null,
    plans: { slug: string; name: string; monthlyCredits: number }[],
  ): AdminUserRow {
    const slug = subscription?.plan ?? FREE_PLAN_SLUG;
    const plan = plans.find((row) => row.slug === slug);

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      emailVerified: user.emailVerified,
      isAdmin: user.isAdmin,
      locale: user.locale,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,

      plan: slug,
      planName: plan?.name ?? slug,
      status: subscription?.status ?? 'active',
      credits: subscription?.credits ?? 0,
      monthly: plan?.monthlyCredits ?? 0,
      // Un joueur sans abonnement n'en a pas encore ouvert un : la date de
      // creation du compte vaut ancre, c'est celle que `ensure` prendra.
      renewsAt: (subscription?.periodEnd ?? user.createdAt).toISOString(),
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      stripeCustomerId: subscription?.stripeCustomerId ?? null,
      stripeSubscriptionId: subscription?.stripeSubscriptionId ?? null,
    };
  }
}
