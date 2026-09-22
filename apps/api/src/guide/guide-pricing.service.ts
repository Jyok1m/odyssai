import { Injectable, Logger } from '@nestjs/common';
import { CREDIT_COSTS } from '@odyssai/engine';
import type { UiLocale } from '@odyssai/schemas';
import { PlansService } from '../plans/plans.service.js';

/*
  Les paliers, en clair, pour le guide.

  Le corpus est genere depuis les messages du site, ou aucun montant ne
  figure : les prix vivent chez Stripe et les dotations en base, et les
  recopier dans un fichier de traduction ferait deux verites. Le guide les
  recoit donc a part, releves au moment de la question.

  Rien n'est mis en cache, comme dans `PlansService` : une lecture de plus
  avant un appel au modele est negligeable, et un cache ferait citer un prix
  que l'administrateur croit avoir change.
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
