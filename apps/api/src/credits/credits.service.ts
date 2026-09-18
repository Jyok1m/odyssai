import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaClient, type Plan, type Subscription } from '@odyssai/db';
import {
  FOUNDER_BONUS,
  FREE_PLAN_SLUG,
  creditsFor,
  nextPeriod,
  type CreditAction,
} from '@odyssai/engine';
import { PlansService } from '../plans/plans.service.js';
import { PRISMA } from '../prisma/prisma.module.js';

/** La reserve est vide : l'action est refusee avant tout appel au modele. */
export class OutOfCreditsError extends Error {
  readonly needed: number;
  readonly balance: number;

  constructor(needed: number, balance: number) {
    super('reserve epuisee');
    this.name = 'OutOfCreditsError';
    this.needed = needed;
    this.balance = balance;
  }
}

/**
 * La reserve d'un joueur.
 *
 * Postgres est la verite, pas Redis. Le budget du guide vit en Redis parce
 * qu'il est anonyme, tres frequent et approximatif : une eviction y coute une
 * estimation. Un credit est facture : une eviction effacerait la consommation
 * d'un mois paye.
 *
 * On debite avant l'appel et on rembourse s'il echoue. Le prix d'une action
 * est connu d'avance, contrairement a un budget en dollars : il n'y a pas de
 * danse reserver puis regler a reproduire.
 */
@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly plans: PlansService,
  ) {}

  /**
   * L'abonnement du joueur, cree au besoin et roule si sa periode est passee.
   *
   * Le roulement est paresseux, a la lecture : une tache planifiee qui
   * parcourrait tous les comptes chaque nuit ferait le meme travail en moins
   * fiable, et laisserait un joueur sans reserve jusqu'a son passage.
   */
  async ensure(userId: string, now: Date = new Date()): Promise<Subscription> {
    const existing = await this.prisma.subscription.findUnique({
      where: { userId },
    });

    if (!existing) return this.open(userId, now);
    if (existing.periodEnd > now) return existing;

    return this.roll(existing, now);
  }

  async balance(userId: string): Promise<{ credits: number; plan: string }> {
    const subscription = await this.ensure(userId);
    return { credits: subscription.credits, plan: subscription.plan };
  }

  /**
   * Debite, ou refuse. Rend l'identifiant de l'ecriture, qui sert a rembourser
   * si l'appel echoue ensuite.
   */
  async spend(
    action: CreditAction,
    userId: string,
    ref?: string,
  ): Promise<string | null> {
    const cost = creditsFor(action);
    if (cost === 0) return null;

    /**
     * Un administrateur n'a pas de reserve a epuiser.
     *
     * Il doit pouvoir jouer autant qu'il faut pour verifier ce qu'il livre, et
     * sa consommation n'est facturee a personne. Rien n'est debite, donc rien
     * ne s'ecrit au grand livre : une ligne raconterait une depense qui n'a
     * pas eu lieu.
     *
     * Ce que ses parties coutent en modeles reste compte : `llm_usage`
     * journalise chaque appel quel qu'en soit le point de depart, et c'est lui
     * la comptabilite. Seule la reserve ne bouge pas.
     *
     * Contrepartie a garder en tete : l'ecran de reserve epuisee ne
     * s'affichera jamais pour lui. Le verifier demande un compte ordinaire.
     */
    if (await this.unlimited(userId)) return null;

    const subscription = await this.ensure(userId);
    if (subscription.credits < cost) {
      throw new OutOfCreditsError(cost, subscription.credits);
    }

    return this.write(subscription.id, -cost, action, ref);
  }

  /**
   * Rembourse une ecriture. Une action qui a echoue ne doit rien couter : le
   * joueur n'a pas eu son tour.
   */
  async refund(entryId: string): Promise<void> {
    try {
      const entry = await this.prisma.creditEntry.findUnique({
        where: { id: entryId },
      });
      if (!entry || entry.delta >= 0) return;

      await this.write(entry.subscriptionId, -entry.delta, 'refund', entry.id);
    } catch (error: unknown) {
      // Un remboursement rate se voit dans le grand livre, qui reste juste :
      // le debit y figure, le credit n'y figure pas.
      this.logger.error(`remboursement impossible (${entryId}) : ${String(error)}`);
    }
  }

  /** Une seule transaction : le solde et le grand livre ne peuvent pas diverger. */
  private async write(
    subscriptionId: string,
    delta: number,
    reason: string,
    ref?: string,
  ): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id: subscriptionId },
        data: { credits: { increment: delta } },
      });

      const entry = await tx.creditEntry.create({
        data: {
          subscriptionId,
          delta,
          reason,
          ref: ref ?? null,
          balance: updated.credits,
        },
      });

      return entry.id;
    });
  }

  private async open(userId: string, now: Date): Promise<Subscription> {
    const plan = await this.plans.free();
    const welcome = plan.monthlyCredits + plan.welcomeCredits;
    const bonus = await this.founderBonus(userId);

    const subscription = await this.prisma.subscription.create({
      data: {
        userId,
        plan: plan.slug,
        credits: welcome + bonus,
        welcomed: true,
        periodStart: now,
        periodEnd: nextPeriod(now),
      },
    });

    // Deux ecritures plutot qu'une somme : le grand livre est en ajout seul et
    // se relit des annees apres, quand le bonus n'existera plus. « 80 credits »
    // ne dirait pas pourquoi ce joueur en a recu trente de plus que le suivant.
    await this.prisma.creditEntry.create({
      data: { subscriptionId: subscription.id, delta: welcome, reason: 'welcome', balance: welcome },
    });

    if (bonus > 0) {
      await this.prisma.creditEntry.create({
        data: {
          subscriptionId: subscription.id,
          delta: bonus,
          reason: 'founder',
          balance: welcome + bonus,
        },
      });
    }

    return subscription;
  }

  /**
   * Le bonus des premiers arrives, zero pour ceux d'apres.
   *
   * Le rang se lit sur la date d'inscription et non sur un compteur : un
   * compteur se desynchronise d'une suppression de compte ou d'une reprise,
   * une date se relit, et le calcul rejoue rend la meme reponse.
   *
   * Un administrateur n'y a pas droit et n'occupe pas une des cent places : sa
   * reserve n'est jamais debitee, lui donner trente credits de plus ne
   * changerait rien et prendrait la place d'un joueur.
   *
   * Contrepartie assumee : un compte supprime libere sa place, le rang etant
   * le nombre de joueurs inscrits avant et non un numero attribue. Tant que
   * personne ne s'est vu promettre un numero, c'est le moins surprenant.
   */
  /**
   * Vrai quand la reserve de ce compte ne se debite pas.
   *
   * Une lecture indexee de plus par action payante, negligeable devant l'appel
   * au modele qui suit. La mettre en cache ferait jouer un compte sur un droit
   * que l'administrateur croirait avoir retire.
   */
  private async unlimited(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });

    return user?.isAdmin ?? false;
  }

  private async founderBonus(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isAdmin: true, createdAt: true },
    });
    if (!user || user.isAdmin) return 0;

    const before = await this.prisma.user.count({
      where: { isAdmin: false, createdAt: { lt: user.createdAt } },
    });

    return before < FOUNDER_BONUS.rank ? FOUNDER_BONUS.credits : 0;
  }

  /**
   * Les credits ne se reportent pas d'une periode a l'autre : la reserve est
   * remise a la dotation du plan, pas augmentee. Sans cela un joueur absent
   * six mois reviendrait avec six mois d'avance, et le plan ne bornerait plus
   * rien.
   *
   * La dotation est relue en base a chaque roulement : un palier modifie au
   * tableau de bord s'applique donc a la periode suivante, jamais a celle que
   * le joueur est en train de vivre.
   */
  private async roll(subscription: Subscription, now: Date): Promise<Subscription> {
    // Un abonnement resilie ou impaye retombe au palier libre plutot que de
    // renouveler une dotation qui n'est plus payee.
    const entitled = subscription.status === 'active';
    const plan: Plan = entitled
      ? await this.plans.bySlug(subscription.plan)
      : await this.plans.free();

    /**
     * Un palier sans dotation ne reverse rien, donc il ne reprend rien : le
     * joueur garde ce qu'il n'a pas depense tant que son compte existe.
     *
     * La regle « les credits ne se reportent pas » borne un abonne qui en
     * recoit de nouveaux chaque mois, sans quoi six mois d'absence donneraient
     * six mois d'avance. Appliquee a une dotation nulle elle ne borne plus
     * rien : elle confisque une reserve offerte que personne n'a remplacee.
     */
    const granted =
      plan.monthlyCredits > 0 ? plan.monthlyCredits : subscription.credits;

    let start = subscription.periodEnd;
    while (nextPeriod(start) <= now) start = nextPeriod(start);

    return this.prisma.$transaction(async (tx) => {
      const rolled = await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          credits: granted,
          periodStart: start,
          periodEnd: nextPeriod(start),
          plan: entitled ? subscription.plan : FREE_PLAN_SLUG,
        },
      });

      // Rien ne s'ecrit quand rien ne bouge : le grand livre raconte des
      // mouvements, et une ligne a zero pour chaque mois d'un joueur inactif
      // le rendrait illisible sans rien y ajouter.
      if (granted !== subscription.credits) {
        await tx.creditEntry.create({
          data: {
            subscriptionId: rolled.id,
            delta: granted - subscription.credits,
            reason: 'grant',
            ref: start.toISOString(),
            balance: granted,
          },
        });
      }

      return rolled;
    });
  }
}
