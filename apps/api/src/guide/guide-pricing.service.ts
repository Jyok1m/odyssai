import { Injectable, Logger } from '@nestjs/common';
import { CREDIT_COSTS } from '@odyssai/engine';
import type { UiLocale } from '@odyssai/schemas';
import { PlansService } from '../plans/plans.service.js';

/*
  Les paliers, en clair, pour le guide. Aucun montant ne figure dans le
  corpus : les prix vivent chez Stripe et les dotations en base, les recopier
  dans une traduction ferait deux verites. Ils sont donc releves a chaque
  question, et rien n'est mis en cache.
*/
@Injectable()
export class GuidePricingService {
  private readonly logger = new Logger(GuidePricingService.name);

  constructor(private readonly plans: PlansService) {}

  /*
    Une ligne par palier, plus le bareme par action.

    Vide en cas d'echec : le prompt sait se passer du bloc, et le modele a
    consigne de ne jamais citer un prix quand il est absent. Mieux vaut un
    guide qui renvoie vers la page des tarifs qu'un guide qui invente.
  */
  async block(locale: UiLocale): Promise<string> {
    try {
      const plans = await this.plans.all();
      const lines = plans.map((plan) => this.line(locale, plan));

      lines.push(
        locale === 'fr'
          ? `Un tour de jeu coute ${CREDIT_COSTS.turn} credit, un message de creation de personnage ${CREDIT_COSTS.characterMessage}, la creation d'un monde ${CREDIT_COSTS.worldGeneration}.`
          : `A game turn costs ${CREDIT_COSTS.turn} credit, a character creation message ${CREDIT_COSTS.characterMessage}, creating a world ${CREDIT_COSTS.worldGeneration}.`,
      );

      return lines.join('\n');
    } catch (error: unknown) {
      this.logger.warn(`tarifs indisponibles pour le guide : ${String(error)}`);
      return '';
    }
  }

  private line(
    locale: UiLocale,
    plan: {
      name: string;
      monthlyCredits: number;
      welcomeCredits: number;
      amountCents: number | null;
      currency: string;
      comingSoon: boolean;
    },
  ): string {
    const price =
      plan.amountCents === null
        ? locale === 'fr'
          ? 'offert'
          : 'free'
        : new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
            style: 'currency',
            currency: plan.currency.toUpperCase(),
          }).format(plan.amountCents / 100) + (locale === 'fr' ? ' par mois' : ' per month');

    const grant =
      plan.monthlyCredits > 0
        ? locale === 'fr'
          ? `${plan.monthlyCredits} credits chaque mois`
          : `${plan.monthlyCredits} credits every month`
        : locale === 'fr'
          ? `${plan.welcomeCredits} credits a l'inscription, sans renouvellement`
          : `${plan.welcomeCredits} credits on sign-up, no renewal`;

    const soon = plan.comingSoon
      ? locale === 'fr'
        ? ', pas encore en vente'
        : ', not on sale yet'
      : '';

    return `${plan.name} : ${price}, ${grant}${soon}.`;
  }
}
