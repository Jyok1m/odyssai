import { Inject, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaClient, type User } from '@odyssai/db';
import { CREDIT_COSTS, FREE_PLAN_SLUG, nextPeriod } from '@odyssai/engine';
import type { BillingCatalog, BillingSummary } from '@odyssai/schemas';
import { AppConfig } from '../config/app-config.js';
import { BillingConfig } from '../config/billing-config.js';
import { CreditsService } from '../credits/credits.service.js';
import { PlansService } from '../plans/plans.service.js';
import { PRISMA } from '../prisma/prisma.module.js';
import { STRIPE } from '../stripe/stripe.module.js';

// Stripe n'est pas configure : rien a vendre, et le palier libre suffit.
export class BillingDisabledError extends Error {
  constructor() {
    super('facturation indisponible');
    this.name = 'BillingDisabledError';
  }
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(STRIPE) private readonly stripe: Stripe | null,
    private readonly config: BillingConfig,
    private readonly app: AppConfig,
    private readonly credits: CreditsService,
    private readonly plans: PlansService,
  ) {}

  /*
    Ce qui se vend et ce que cela coute.

    `purchasable` est faux tant que le prix d'un plan n'est pas configure chez
    Stripe : l'ecran cache alors l'offre plutot que de proposer un bouton qui
    repondrait 503.
  */
  async catalog(): Promise<BillingCatalog> {
    const plans = await this.plans.all();

    return {
      costs: {
        turn: CREDIT_COSTS.turn,
        characterMessage: CREDIT_COSTS.characterMessage,
        worldGeneration: CREDIT_COSTS.worldGeneration,
      },
      plans: plans.map((plan) => ({
        id: plan.slug,
        name: plan.name,
        monthly: plan.monthlyCredits,
        welcome: plan.welcomeCredits,
        amountCents: plan.amountCents,
        currency: plan.currency,
        purchasable:
          this.config.enabled && plan.stripePriceId !== null && !plan.comingSoon,
        recommended: plan.recommended,
        comingSoon: plan.comingSoon,
      })),
    };
  }

  /*
    L'etat de la reserve, tel que l'ecran de compte l'affiche.

    `purchasable` vient de la configuration et non du plan : sans cle Stripe,
    l'ecran doit cacher la vente plutot que proposer un bouton qui repondrait
    503.
  */
  async summary(user: User): Promise<BillingSummary> {
    const subscription = await this.credits.ensure(user.id);
    const plan = await this.plans.bySlug(subscription.plan);

    return {
      plan: plan.slug,
      planName: plan.name,
      status: subscription.status,
      credits: subscription.credits,
      monthly: plan.monthlyCredits,
      renewsAt: subscription.periodEnd.toISOString(),
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      purchasable: this.config.enabled,
      manageable: this.config.enabled && subscription.stripeCustomerId !== null,
      unlimited: user.isAdmin,
    };
  }

  private client(): Stripe {
    if (!this.stripe) throw new BillingDisabledError();
    return this.stripe;
  }

  /*
    Le client Stripe du joueur, cree au besoin.

    `users.email` n'est pas unique : c'est l'identifiant Stripe stocke chez
    nous qui fait le lien, jamais l'adresse. On passe quand meme `metadata`
    pour retrouver le joueur depuis le tableau de bord Stripe.
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

  /*
    Une session de paiement. La saisie de carte reste chez Stripe.

    Un palier archive ne se souscrit plus, meme si quelqu'un a garde l'onglet
    ouvert : le retirer de la vente doit vraiment le retirer.
  */
  async checkout(user: User, slug: string): Promise<string> {
    const plan = await this.plans.bySlug(slug);
    if (plan.archived || !plan.stripePriceId) throw new BillingDisabledError();

    const price = plan.stripePriceId;

    const account = this.accountUrl(user);

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

  /*
    Le portail de Stripe, pour changer de moyen de paiement ou resilier.
    Construire cet ecran nous-memes n'apporterait rien et exposerait des
    donnees de carte.
  */
  async portal(user: User): Promise<string> {
    const session = await this.client().billingPortal.sessions.create({
      customer: await this.customerOf(user),
      return_url: this.accountUrl(user),
    });

    return session.url;
  }

  /*
    Ou revenir apres Stripe.

    Le chemin est construit ici et non recu du navigateur : accepter une URL
    de retour du client ouvrirait une redirection arbitraire. Les deux
    chemins localises sont recopies de `routing.ts` du web, faute de source
    partagee entre les deux applications.
  */
  private accountUrl(user: User): string {
    const path = user.locale === 'en' ? '/en/account' : '/fr/compte';
    return new URL(path, this.app.webBaseUrl).toString();
  }

  /*
    Resilie immediatement, et seulement depuis le tableau de bord : un joueur
    passe par le portail Stripe, qui resilie en fin de periode. C'est le
    webhook `customer.subscription.deleted` qui fera retomber la ligne au
    palier libre, pas cet appel. Aucun remboursement.
  */
  async cancelSubscription(stripeSubscriptionId: string): Promise<void> {
    await this.client().subscriptions.cancel(stripeSubscriptionId);
    this.logger.warn(`abonnement resilie par un administrateur : ${stripeSubscriptionId}`);
  }

  /*
    Verifie la signature, puis traite une seule fois.

    La signature se calcule sur le corps brut : un `JSON.stringify` ne
    reproduit pas l'octet pres, et la verification echouerait.
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

  // Relit l'abonnement chez Stripe quand l'evenement n'en porte que l'identifiant.
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
    const plan = await this.plans.byPriceId(priceId);

    if (!plan) {
      this.logger.warn(`prix inconnu, abonnement ignore : ${priceId}`);
      return;
    }

    await this.prisma.subscription.update({
      where: { id: local.id },
      data: {
        plan: plan.slug,
        // `trialing` vaut `active` pour nous : la seule question que le statut
        // tranche ici est celle du droit a la dotation.
        status: subscription.status === 'trialing' ? 'active' : subscription.status,
        stripeSubscriptionId: subscription.id,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    });
  }

  // Retour au palier libre, une fois les relances de Stripe epuisees.
  private async downgrade(subscription: Stripe.Subscription): Promise<void> {
    const local = await this.find(String(subscription.customer));
    if (!local) return;

    await this.prisma.subscription.update({
      where: { id: local.id },
      data: {
        plan: FREE_PLAN_SLUG,
        status: 'canceled',
        stripeSubscriptionId: null,
      },
    });

    this.logger.log(`retour au palier libre : ${local.userId}`);
  }

  /*
    Le renouvellement credite la reserve et deplace l'ancre.

    L'ancre vient de la facture, pas du calendrier : un abonne du 20 ne doit
    pas voir sa reserve repartir le 1er.
  */
  private async renew(invoice: Stripe.Invoice): Promise<void> {
    /*
      L'ordre des webhooks n'est pas garanti : `invoice.paid` peut preceder
      `customer.subscription.created`, et sans cette relecture un joueur qui
      vient de payer recevrait la dotation du palier libre.
    */
    await this.syncById(invoice.parent?.subscription_details?.subscription ?? null);

    const local = await this.find(String(invoice.customer));
    if (!local) return;

    const plan = await this.plans.bySlug(local.plan);
    const start = new Date((invoice.period_start ?? Date.now() / 1000) * 1000);

    // Lu avant la transaction : le grand livre enregistre le mouvement, donc
    // l'ecart entre ce qui restait et la nouvelle dotation.
    const before = local.credits;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({
        where: { id: local.id },
        data: {
          credits: plan.monthlyCredits,
          status: 'active',
          periodStart: start,
          periodEnd: nextPeriod(start),
        },
      });

      await tx.creditEntry.create({
        data: {
          subscriptionId: updated.id,
          delta: plan.monthlyCredits - before,
          reason: 'grant',
          ref: invoice.id,
          balance: plan.monthlyCredits,
        },
      });
    });

    this.logger.log(`reserve renouvelee, plan ${plan.slug} : ${local.userId}`);
  }
}
