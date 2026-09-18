import { Inject, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaClient, type Plan } from '@odyssai/db';
import { FREE_PLAN_SLUG } from '@odyssai/engine';
import type {
  AdminPlan,
  CreatePlanRequest,
  UpdatePlanRequest,
} from '@odyssai/schemas';
import { PlansService } from '../plans/plans.service.js';
import { PRISMA } from '../prisma/prisma.module.js';
import { STRIPE } from '../stripe/stripe.module.js';

export class SlugTakenError extends Error {
  constructor(slug: string) {
    super(`le slug ${slug} est deja pris`);
    this.name = 'SlugTakenError';
  }
}

export class PlanInUseError extends Error {
  readonly subscribers: number;

  constructor(subscribers: number) {
    super(`${subscribers} abonnement(s) portent encore ce palier`);
    this.name = 'PlanInUseError';
    this.subscribers = subscribers;
  }
}

/** Le palier offert ne se retire ni ne s'archive : tout y retombe. */
export class PlanProtectedError extends Error {
  constructor() {
    super(`le palier ${FREE_PLAN_SLUG} ne peut etre ni archive ni supprime`);
    this.name = 'PlanProtectedError';
  }
}

export class PlanNotFoundError extends Error {
  constructor(id: string) {
    super(`palier introuvable : ${id}`);
    this.name = 'PlanNotFoundError';
  }
}

export class StripeUnavailableError extends Error {
  constructor(cause: string) {
    super(`Stripe a refuse : ${cause}`);
    this.name = 'StripeUnavailableError';
  }
}

/**
 * Le CRUD des paliers, base et Stripe ensemble.
 *
 * Un prix Stripe est **immuable** : on ne modifie pas un montant, on cree un
 * nouveau prix et on desactive l'ancien. C'est le piege central de cette
 * classe, et la raison pour laquelle `amountCents` n'est pas un simple champ.
 * Les abonnes en cours gardent le prix qu'ils ont signe jusqu'a leur prochaine
 * facture : Stripe ne rejoue pas un abonnement sur un nouveau prix, et c'est
 * le comportement voulu.
 *
 * Les ecritures chez Stripe passent avant l'ecriture en base : un produit cree
 * sans ligne chez nous se voit et se nettoie, une ligne qui pointe un prix
 * inexistant ferait echouer un paiement.
 */
@Injectable()
export class AdminPlansService {
  private readonly logger = new Logger(AdminPlansService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(STRIPE) private readonly stripe: Stripe | null,
    private readonly plans: PlansService,
  ) {}

  async list(): Promise<AdminPlan[]> {
    const plans = await this.plans.all(true);
    const counts = await this.prisma.subscription.groupBy({
      by: ['plan'],
      _count: { _all: true },
    });

    const counted = new Map(counts.map((row) => [row.plan, row._count._all]));

    return plans.map((plan) => this.toAdmin(plan, counted.get(plan.slug) ?? 0));
  }

  async create(request: CreatePlanRequest): Promise<AdminPlan> {
    const existing = await this.prisma.plan.findUnique({
      where: { slug: request.slug },
    });
    if (existing) throw new SlugTakenError(request.slug);

    let productId: string | null = null;
    let priceId: string | null = null;

    if (request.amountCents !== null) {
      const created = await this.createPrice(
        request.name,
        request.slug,
        request.amountCents,
        request.currency,
      );
      productId = created.productId;
      priceId = created.priceId;
    }

    const plan = await this.prisma.plan.create({
      data: {
        slug: request.slug,
        name: request.name,
        monthlyCredits: request.monthlyCredits,
        welcomeCredits: request.welcomeCredits,
        amountCents: request.amountCents,
        currency: request.currency,
        stripeProductId: productId,
        stripePriceId: priceId,
        sortOrder: request.sortOrder,
        comingSoon: request.comingSoon,
      },
    });

    this.logger.log(`palier cree : ${plan.slug}`);
    return this.toAdmin(plan, 0);
  }

  async update(id: string, request: UpdatePlanRequest): Promise<AdminPlan> {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new PlanNotFoundError(id);

    if (plan.slug === FREE_PLAN_SLUG && request.archived === true) {
      throw new PlanProtectedError();
    }

    const data: Record<string, unknown> = {
      ...(request.name !== undefined ? { name: request.name } : {}),
      ...(request.monthlyCredits !== undefined
        ? { monthlyCredits: request.monthlyCredits }
        : {}),
      ...(request.welcomeCredits !== undefined
        ? { welcomeCredits: request.welcomeCredits }
        : {}),
      ...(request.sortOrder !== undefined ? { sortOrder: request.sortOrder } : {}),
      ...(request.archived !== undefined ? { archived: request.archived } : {}),
      ...(request.recommended !== undefined ? { recommended: request.recommended } : {}),
      ...(request.comingSoon !== undefined ? { comingSoon: request.comingSoon } : {}),
    };

    if (request.name !== undefined && plan.stripeProductId) {
      await this.callStripe(() =>
        this.client().products.update(plan.stripeProductId!, { name: request.name! }),
      );
    }

    /**
     * Le montant change : un prix Stripe etant immuable, on en cree un et on
     * desactive l'ancien. Sans cela le tableau de bord mentirait, affichant un
     * montant que Stripe ne facture pas.
     *
     * Le montant inchange passe aussi quand aucun prix n'existe. Un palier
     * peut porter un montant sans prix : une migration l'a pose, ou un appel
     * a Stripe a echoue apres l'ecriture. Comparer les seuls montants le
     * laissait invendable a vie, et le remettre en vente demandait de changer
     * le prix puis de le remettre.
     */
    if (
      request.amountCents !== undefined &&
      (request.amountCents !== plan.amountCents || (await this.unusable(plan)))
    ) {
      Object.assign(data, await this.reprice(plan, request.amountCents));
    }

    // Retirer de la vente desactive aussi le prix : un lien de paiement garde
    // en favori ne doit plus aboutir.
    if (request.archived === true && plan.stripePriceId) {
      await this.deactivate(plan.stripePriceId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Un seul palier recommande a la fois. L'index partiel unique de la base
      // refuserait le second : on retire le precedent dans la meme
      // transaction, sinon l'ecriture echouerait sans rien dire d'utile.
      if (request.recommended === true) {
        await tx.plan.updateMany({
          where: { recommended: true, id: { not: id } },
          data: { recommended: false },
        });
      }

      return tx.plan.update({ where: { id }, data });
    });

    const subscribers = await this.countSubscribers(updated.slug);

    this.logger.log(`palier modifie : ${updated.slug}`);
    return this.toAdmin(updated, subscribers);
  }

  /**
   * Supprime, ou refuse.
   *
   * Un palier que quelqu'un porte ne se supprime pas : la cle etrangere le
   * refuserait de toute facon, et le grand livre doit rester lisible. On
   * l'archive a la place, ce que l'ecran propose.
   */
  async remove(id: string): Promise<void> {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new PlanNotFoundError(id);
    if (plan.slug === FREE_PLAN_SLUG) throw new PlanProtectedError();

    const subscribers = await this.countSubscribers(plan.slug);
    if (subscribers > 0) throw new PlanInUseError(subscribers);

    if (plan.stripePriceId) await this.deactivate(plan.stripePriceId);
    if (plan.stripeProductId) {
      await this.callStripe(() =>
        this.client().products.update(plan.stripeProductId!, { active: false }),
      );
    }

    await this.prisma.plan.delete({ where: { id } });
    this.logger.log(`palier supprime : ${plan.slug}`);
  }

  private client(): Stripe {
    if (!this.stripe) throw new StripeUnavailableError('aucune cle configuree');
    return this.stripe;
  }

  /**
   * Cree le produit et son prix.
   *
   * La cle d'idempotence est derivee du slug et du montant : une requete
   * rejouee apres une coupure reseau retombe sur le meme produit au lieu d'en
   * creer un second, invisible depuis chez nous.
   */
  private async createPrice(
    name: string,
    slug: string,
    amountCents: number,
    currency: string,
  ): Promise<{ productId: string; priceId: string }> {
    const product = await this.callStripe(() =>
      this.client().products.create(
        { name, metadata: { slug } },
        { idempotencyKey: `odyssai-product-${slug}` },
      ),
    );

    const price = await this.callStripe(() =>
      this.client().prices.create(
        {
          product: product.id,
          currency,
          unit_amount: amountCents,
          recurring: { interval: 'month' },
          metadata: { slug },
        },
        { idempotencyKey: `odyssai-price-${slug}-${amountCents}-${currency}` },
      ),
    );

    return { productId: product.id, priceId: price.id };
  }

  /** Nouveau prix sur le meme produit, ancien desactive. */
  /**
   * Vrai quand le palier porte un montant qu'aucun prix actif ne facture.
   *
   * Un prix absent, une migration l'ayant pose sans passer par Stripe, ou un
   * prix desactive par un aller-retour de montant : dans les deux cas le
   * paiement echouerait, et il faut le refaire. La lecture chez Stripe ne coute
   * qu'a la modification d'un palier, ce qui arrive quelques fois par an.
   */
  private async unusable(plan: Plan): Promise<boolean> {
    if (plan.amountCents === null) return false;
    // Sans cle, il n'y a rien a reparer et rien a interroger : renommer un
    // palier payant ne doit pas echouer parce que Stripe est absent.
    if (!this.stripe) return false;
    if (plan.stripePriceId === null) return true;

    const price = await this.callStripe(() =>
      this.client().prices.retrieve(plan.stripePriceId!),
    );

    return !price.active;
  }

  private async reprice(
    plan: Plan,
    amountCents: number | null,
  ): Promise<Record<string, unknown>> {
    // Le palier redevient offert : plus rien a vendre, le prix se retire.
    if (amountCents === null) {
      if (plan.stripePriceId) await this.deactivate(plan.stripePriceId);
      return { amountCents: null, stripePriceId: null };
    }

    if (!plan.stripeProductId) {
      const created = await this.createPrice(
        plan.name,
        plan.slug,
        amountCents,
        plan.currency,
      );
      return {
        amountCents,
        stripeProductId: created.productId,
        stripePriceId: created.priceId,
      };
    }

    const created = await this.callStripe(() =>
      this.client().prices.create(
        {
          product: plan.stripeProductId!,
          currency: plan.currency,
          unit_amount: amountCents,
          recurring: { interval: 'month' },
          metadata: { slug: plan.slug },
        },
        {
          idempotencyKey: `odyssai-price-${plan.slug}-${amountCents}-${plan.currency}`,
        },
      ),
    );

    /**
     * La cle d'idempotence rend le prix deja cree pour ce montant, dans l'etat
     * ou il est. Un aller-retour de montant le laisse desactive, et Stripe
     * refuse un prix inactif au paiement : « The price specified is inactive ».
     * On le remet en service plutot que d'ecrire en base un prix invendable.
     */
    const price = created.active
      ? created
      : await this.callStripe(() =>
          this.client().prices.update(created.id, { active: true }),
        );

    /**
     * Ne pas desactiver ce qu'on vient de remettre en service. Avec la meme
     * cle d'idempotence, l'ancien prix et le nouveau sont le meme objet, et
     * l'ordre « creer puis desactiver l'ancien » se retournait contre lui.
     */
    if (plan.stripePriceId && plan.stripePriceId !== price.id) {
      await this.deactivate(plan.stripePriceId);
    }

    return { amountCents, stripePriceId: price.id };
  }

  /**
   * Desactive un prix. Stripe ne les supprime pas : les factures passees y
   * renvoient, et un prix efface rendrait l'historique illisible.
   */
  private async deactivate(priceId: string): Promise<void> {
    await this.callStripe(() => this.client().prices.update(priceId, { active: false }));
  }

  private async countSubscribers(slug: string): Promise<number> {
    return this.prisma.subscription.count({ where: { plan: slug } });
  }

  /**
   * Le message de Stripe peut porter une partie de la requete : seul le code
   * d'erreur sort d'ici, jamais le corps.
   */
  private async callStripe<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error: unknown) {
      if (error instanceof Stripe.errors.StripeError) {
        this.logger.error(`Stripe a refuse (${error.type}) : ${error.code ?? 'sans code'}`);
        throw new StripeUnavailableError(error.code ?? error.type);
      }
      throw error;
    }
  }

  private toAdmin(plan: Plan, subscribers: number): AdminPlan {
    return {
      id: plan.id,
      slug: plan.slug,
      name: plan.name,
      monthlyCredits: plan.monthlyCredits,
      welcomeCredits: plan.welcomeCredits,
      amountCents: plan.amountCents,
      currency: plan.currency,
      stripeProductId: plan.stripeProductId,
      stripePriceId: plan.stripePriceId,
      archived: plan.archived,
      recommended: plan.recommended,
      comingSoon: plan.comingSoon,
      sortOrder: plan.sortOrder,
      subscriberCount: subscribers,
      removable: plan.slug !== FREE_PLAN_SLUG && subscribers === 0,
      createdAt: plan.createdAt.toISOString(),
    };
  }
}
