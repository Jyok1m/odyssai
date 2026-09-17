import { Inject, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaClient, type User } from '@odyssai/db';
import { CREDIT_COSTS, nextPeriod, planOf, type PlanId } from '@odyssai/engine';
import type { BillingSummary, CreditPrice } from '@odyssai/schemas';
import { AppConfig } from '../config/app-config.js';
import { BillingConfig } from '../config/billing-config.js';
import { CreditsService } from '../credits/credits.service.js';
import { PRISMA } from '../prisma/prisma.module.js';

/** Stripe n'est pas configure : rien a vendre, et le palier libre suffit. */
export class BillingDisabledError extends Error {
  constructor() {
    super('facturation indisponible');
    this.name = 'BillingDisabledError';
  }
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe | null;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly config: BillingConfig,
    private readonly app: AppConfig,
    private readonly credits: CreditsService,
  ) {
    this.stripe = config.enabled
      ? new Stripe(config.secretKey, { apiVersion: '2026-08-26.dahlia' })
      : null;
  }

  /** Le bareme publie. Une constante du moteur, servie telle quelle. */
  prices(): CreditPrice {
    return {
      turn: CREDIT_COSTS.turn,
      characterMessage: CREDIT_COSTS.characterMessage,
      worldGeneration: CREDIT_COSTS.worldGeneration,
    };
  }

  /**
   * L'etat de la reserve, tel que l'ecran de compte l'affiche.
   *
   * `purchasable` vient de la configuration et non du plan : sans cle Stripe,
   * l'ecran doit cacher la vente plutot que proposer un bouton qui repondrait
   * 503.
   */
  async summary(user: User): Promise<BillingSummary> {
    const subscription = await this.credits.ensure(user.id);
    const plan = planOf(subscription.plan);

    return {
      plan: plan.id,
      status: subscription.status,
      credits: subscription.credits,
      monthly: plan.monthly,
      renewsAt: subscription.periodEnd.toISOString(),
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      purchasable: this.config.enabled,
    };
  }

  private client(): Stripe {
    if (!this.stripe) throw new BillingDisabledError();
    return this.stripe;
  }

  /**
   * Le client Stripe du joueur, cree au besoin.
   *
   * `users.email` n'est pas unique : c'est l'identifiant Stripe stocke chez
   * nous qui fait le lien, jamais l'adresse. On passe quand meme `metadata`
   * pour retrouver le joueur depuis le tableau de bord Stripe.
   */
  private async customerOf(user: User): Promise<string> {
    const subscription = await this.credits.ensure(user.id);
    if (subscription.stripeCustomerId) return subscription.stripeCustomerId;

    const customer = await this.client().customers.create({
      email: user.email,
      metadata: { userId: user.id },
    });

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { stripeCustomerId: customer.id },
    });

    return customer.id;
  }

  /** Une session de paiement. La saisie de carte reste chez Stripe. */
  async checkout(user: User, plan: PlanId): Promise<string> {
    const price = this.config.priceOf(plan);
    if (!price) throw new BillingDisabledError();

    const account = new URL('/compte', this.app.webBaseUrl).toString();

    const session = await this.client().checkout.sessions.create({
      mode: 'subscription',
      customer: await this.customerOf(user),
      line_items: [{ price, quantity: 1 }],
      success_url: `${account}?abonnement=ok`,
      cancel_url: `${account}?abonnement=annule`,
      // Retrouve le joueur meme si le client Stripe changeait de main.
      subscription_data: { metadata: { userId: user.id } },
      locale: user.locale,
    });

    if (!session.url) throw new BillingDisabledError();
    return session.url;
  }

  /**
   * Le portail de Stripe, pour changer de moyen de paiement ou resilier.
   * Construire cet ecran nous-memes n'apporterait rien et exposerait des
   * donnees de carte.
   */
  async portal(user: User): Promise<string> {
    const session = await this.client().billingPortal.sessions.create({
      customer: await this.customerOf(user),
      return_url: new URL('/compte', this.app.webBaseUrl).toString(),
    });

    return session.url;
  }

  /**
   * Verifie la signature, puis traite une seule fois.
   *
   * La signature se calcule sur le corps brut : un `JSON.stringify` ne
   * reproduit pas l'octet pres, et la verification echouerait.
   */
  async handle(raw: Buffer, signature: string): Promise<void> {
    const event = this.client().webhooks.constructEvent(
      raw,
      signature,
      this.config.webhookSecret,
    );

    // Stripe rejoue jusqu'a obtenir un 2xx : un invoice.paid traite deux fois
    // crediterait deux fois. L'insertion echoue sur la cle, et c'est le
    // verrou.
    try {
      await this.prisma.stripeEvent.create({
        data: { id: event.id, type: event.type },
      });
    } catch {
      this.logger.log(`evenement deja traite : ${event.id}`);
      return;
    }

    await this.dispatch(event);
  }

  private async dispatch(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      // La souscription est actee ici, mais rien n'est credite : c'est
      // `invoice.paid` qui dit que l'argent est arrive.
      case 'checkout.session.completed':
        await this.syncById(event.data.object.subscription);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.sync(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await this.downgrade(event.data.object);
        break;

      case 'invoice.paid':
        await this.renew(event.data.object);
        break;

      case 'invoice.payment_failed':
        // On ne coupe rien ici : Stripe relance plusieurs jours, et c'est
        // `subscription.deleted` qui tranchera si personne ne paie.
        this.logger.warn(`paiement en echec : ${event.data.object.id}`);
        break;

      default:
        this.logger.log(`evenement ignore : ${event.type}`);
    }
  }

  private async find(customerId: string) {
    return this.prisma.subscription.findUnique({
      where: { stripeCustomerId: customerId },
    });
  }

  /** Relit l'abonnement chez Stripe quand l'evenement n'en porte que l'identifiant. */
  private async syncById(
    subscription: string | Stripe.Subscription | null,
  ): Promise<void> {
    if (!subscription) return;

    await this.sync(
      typeof subscription === 'string'
        ? await this.client().subscriptions.retrieve(subscription)
        : subscription,
    );
  }

  private async sync(subscription: Stripe.Subscription): Promise<void> {
    const local = await this.find(String(subscription.customer));
    if (!local) return;

    const priceId = subscription.items.data[0]?.price.id ?? '';
    const plan = this.config.planOfPrice(priceId);

    if (!plan) {
      this.logger.warn(`prix inconnu, abonnement ignore : ${priceId}`);
      return;
    }

    await this.prisma.subscription.update({
      where: { id: local.id },
      data: {
        plan,
        // `trialing` vaut `active` pour nous : la seule question que le statut
        // tranche ici est celle du droit a la dotation.
        status: subscription.status === 'trialing' ? 'active' : subscription.status,
        stripeSubscriptionId: subscription.id,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    });
  }

  /** Retour au palier libre, une fois les relances de Stripe epuisees. */
  private async downgrade(subscription: Stripe.Subscription): Promise<void> {
    const local = await this.find(String(subscription.customer));
    if (!local) return;

    await this.prisma.subscription.update({
      where: { id: local.id },
      data: { plan: 'free', status: 'canceled', stripeSubscriptionId: null },
    });

    this.logger.log(`retour au palier libre : ${local.userId}`);
  }

  /**
   * Le renouvellement credite la reserve et deplace l'ancre.
   *
   * L'ancre vient de la facture, pas du calendrier : un abonne du 20 ne doit
   * pas voir sa reserve repartir le 1er.
   */
  private async renew(invoice: Stripe.Invoice): Promise<void> {
    // L'ordre des webhooks n'est pas garanti : `invoice.paid` peut preceder
    // `customer.subscription.created`. Sans cette relecture, le plan encore
    // inscrit chez nous serait `free`, et un joueur qui vient de payer
    // recevrait la dotation du palier libre.
    await this.syncById(invoice.parent?.subscription_details?.subscription ?? null);

    const local = await this.find(String(invoice.customer));
    if (!local) return;

    const plan = planOf(local.plan);
    const start = new Date((invoice.period_start ?? Date.now() / 1000) * 1000);

    // Lu avant la transaction : le grand livre enregistre le mouvement, donc
    // l'ecart entre ce qui restait et la nouvelle dotation.
    const before = local.credits;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id: local.id },
        data: {
          credits: plan.monthly,
          status: 'active',
          periodStart: start,
          periodEnd: nextPeriod(start),
        },
      });

      await tx.creditEntry.create({
        data: {
          subscriptionId: updated.id,
          delta: plan.monthly - before,
          reason: 'grant',
          ref: invoice.id,
          balance: plan.monthly,
        },
      });
    });

    this.logger.log(`reserve renouvelee, plan ${plan.id} : ${local.userId}`);
  }
}
