import { describe, expect, it } from 'vitest';
import { CREDIT_COSTS } from '@odyssai/engine';
import { GuidePricingService } from './guide-pricing.service.js';
import type { PlansService } from '../plans/plans.service.js';

const PLANS = [
  {
    name: 'Rider',
    monthlyCredits: 0,
    welcomeCredits: 50,
    amountCents: null,
    currency: 'eur',
    comingSoon: false,
  },
  {
    name: 'Player',
    monthlyCredits: 300,
    welcomeCredits: 0,
    amountCents: 499,
    currency: 'eur',
    comingSoon: false,
  },
  {
    name: 'Dreamer',
    monthlyCredits: 1500,
    welcomeCredits: 0,
    amountCents: 1999,
    currency: 'eur',
    comingSoon: true,
  },
];

function serviceFor(all: () => Promise<unknown>) {
  return new GuidePricingService({ all } as unknown as PlansService);
}

/**
 * Le bloc des tarifs.
 *
 * C'est la seule chose que le guide apprend hors du corpus, et un montant faux
 * s'y lirait comme une promesse. Un test parce que la page de tarifs et le
 * guide doivent dire le meme prix.
 */
describe('tarifs servis au guide', () => {
  it('donne un montant par palier et le bareme par action', async () => {
    const block = await serviceFor(async () => PLANS).block('fr');

    expect(block).toContain('Rider : offert, 50 credits');
    expect(block).toContain('Player');
    expect(block).toContain('300 credits chaque mois');
    expect(block).toContain(String(CREDIT_COSTS.worldGeneration));
  });

  // Un palier annonce mais pas vendable doit se lire comme tel, sinon le guide
  // enverrait quelqu'un acheter ce qui n'est pas en vente.
  it('signale un palier qui n est pas encore en vente', async () => {
    const block = await serviceFor(async () => PLANS).block('fr');

    expect(block).toContain('pas encore en vente');
  });

  /**
   * Le prompt a consigne de ne jamais citer un prix quand le bloc est absent :
   * un guide qui renvoie vers la page des tarifs vaut mieux qu'un guide qui
   * invente, et une base indisponible ne doit pas faire tomber la reponse.
   */
  it('rend une chaine vide plutot que d echouer', async () => {
    const block = await serviceFor(async () => {
      throw new Error('base indisponible');
    }).block('fr');

    expect(block).toBe('');
  });

  it('parle anglais quand on le lui demande', async () => {
    const block = await serviceFor(async () => PLANS).block('en');

    expect(block).toContain('credits on sign-up');
    expect(block).toContain('per month');
  });
});
