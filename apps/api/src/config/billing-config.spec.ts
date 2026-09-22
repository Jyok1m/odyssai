import { afterEach, describe, expect, it } from 'vitest';
import { BillingConfig } from './billing-config.js';

const KEPT = { ...process.env };

function build(overrides: Record<string, string>): BillingConfig {
  process.env = { ...KEPT, ...overrides };
  return new BillingConfig();
}

afterEach(() => {
  process.env = { ...KEPT };
});

describe('configuration Stripe', () => {
  it('se tait quand rien n est configure', () => {
    const config = build({
      STRIPE_PRIVATE_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
    });

    expect(config.enabled).toBe(false);
  });

  /*
    Le garde-fou qui compte : une cle live sur un poste de developpement
    debiterait de vraies cartes.
  */
  it('refuse une cle live hors production', () => {
    expect(() =>
      build({
        ODYSSAI_ENV: 'staging',
        STRIPE_PRIVATE_KEY: 'sk_live_factice',
        STRIPE_WEBHOOK_SECRET: 'whsec_factice',
      }),
    ).toThrow(/live/);
  });

  it('refuse une cle de test en production', () => {
    expect(() =>
      build({
        ODYSSAI_ENV: 'production',
        STRIPE_PRIVATE_KEY: 'sk_test_factice',
        STRIPE_WEBHOOK_SECRET: 'whsec_factice',
      }),
    ).toThrow(/test/);
  });

  it('refuse une cle qui n en est pas une', () => {
    expect(() =>
      build({
        STRIPE_PRIVATE_KEY: 'pk_test_publique',
        STRIPE_WEBHOOK_SECRET: 'whsec_factice',
      }),
    ).toThrow(/sk_test_/);
  });

  // Sans secret de webhook, aucune signature ne se verifie : un inconnu
  // pourrait crediter le compte qu'il veut.
  it('exige le secret de webhook des qu une cle est presente', () => {
    expect(() =>
      build({
        STRIPE_PRIVATE_KEY: 'sk_test_factice',
        STRIPE_WEBHOOK_SECRET: '',
      }),
    ).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  /*
    La copie de dev tourne avec NODE_ENV=production, l'image etant la meme que
    celle de la production : c'est ODYSSAI_ENV qui distingue les deux, et c'est
    tout l'interet de la variable.
  */
  it('accepte une cle de test sur une copie batie en production', () => {
    const config = build({
      NODE_ENV: 'production',
      ODYSSAI_ENV: 'staging',
      STRIPE_PRIVATE_KEY: 'sk_test_factice',
      STRIPE_WEBHOOK_SECRET: 'whsec_factice',
    });

    expect(config.enabled).toBe(true);
    expect(config.live).toBe(false);
  });

  /*
    Les identifiants de prix ne sont plus lus ici : ils vivent dans la table
    `plans`, ecrits par le tableau de bord d'administration. En variable
    d'environnement, mettre un palier en vente demandait un deploiement.
  */
  it('ne lit plus aucun identifiant de prix', () => {
    const config = build({
      STRIPE_PRIVATE_KEY: 'sk_test_factice',
      STRIPE_WEBHOOK_SECRET: 'whsec_factice',
      STRIPE_PRICE_APPRENTI: 'price_perime',
    });

    expect(Object.values(config)).not.toContain('price_perime');
  });
});
