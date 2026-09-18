import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

/**
 * Stripe, et rien d'autre.
 *
 * La cle et le secret de webhook, rien d'autre. Les identifiants de prix
 * vivaient ici : ils sont passes dans la table `plans`, ou le tableau de bord
 * d'administration les ecrit lui-meme en creant le produit chez Stripe. Les
 * garder en variable d'environnement obligeait a un deploiement pour mettre un
 * palier en vente.
 *
 * Tout est optionnel : sans cle, la facturation se tait et le palier libre
 * suffit a jouer. C'est ce qui permet de developper sans compte Stripe.
 */
const EnvSchema = z
  .object({
    /**
     * Le deploiement, et non la facon dont Node est bati.
     *
     * `NODE_ENV` ne peut pas servir ici : les deux copies du site tournent
     * avec `NODE_ENV=production`, l'image etant la meme, alors que celle de
     * dev doit justement travailler en mode test chez Stripe. Sans cette
     * variable, la copie de dev refuserait de demarrer ou debiterait de
     * vraies cartes, et les deux sont inacceptables.
     */
    ODYSSAI_ENV: z
      .enum(['development', 'staging', 'production'])
      .default('development'),

    /** Nommee ainsi parce que c'est le nom deja pose dans le .env du projet. */
    STRIPE_PRIVATE_KEY: z.string().default(''),
    STRIPE_WEBHOOK_SECRET: z.string().default(''),
  })
  .superRefine((env, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    if (env.STRIPE_PRIVATE_KEY && !/^sk_(test|live)_/.test(env.STRIPE_PRIVATE_KEY)) {
      fail('STRIPE_PRIVATE_KEY', 'une cle secrete Stripe commence par sk_test_ ou sk_live_');
    }

    // Le meme garde-fou que pour les cles de test Turnstile, dans l'autre
    // sens : une cle live hors production facturerait de vraies cartes.
    if (
      env.ODYSSAI_ENV !== 'production' &&
      env.STRIPE_PRIVATE_KEY.startsWith('sk_live_')
    ) {
      fail('STRIPE_PRIVATE_KEY', 'cle live interdite hors production : elle debite de vraies cartes');
    }

    if (
      env.ODYSSAI_ENV === 'production' &&
      env.STRIPE_PRIVATE_KEY.startsWith('sk_test_')
    ) {
      fail('STRIPE_PRIVATE_KEY', 'cle de test en production : aucun paiement ne serait reel');
    }

    if (env.STRIPE_PRIVATE_KEY && !env.STRIPE_WEBHOOK_SECRET) {
      fail('STRIPE_WEBHOOK_SECRET', 'requis des lors qu une cle Stripe est presente : sans lui aucune signature ne se verifie');
    }
  });

type Env = z.infer<typeof EnvSchema>;

@Injectable()
export class BillingConfig {
  private readonly logger = new Logger(BillingConfig.name);
  private readonly env: Env;

  constructor() {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `  ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
        .join('\n');
      throw new Error(`Configuration Stripe invalide, voir .env.example :\n${details}`);
    }

    this.env = parsed.data;

    if (!this.enabled) {
      this.logger.warn(
        'Stripe absent : seul le palier libre est disponible, aucun abonnement ne peut etre souscrit',
      );
    }
  }

  get enabled(): boolean {
    return this.env.STRIPE_PRIVATE_KEY.length > 0;
  }

  get live(): boolean {
    return this.env.STRIPE_PRIVATE_KEY.startsWith('sk_live_');
  }

  /** Jamais journalisee ni renvoyee : elle ne sort que vers le SDK. */
  get secretKey(): string {
    return this.env.STRIPE_PRIVATE_KEY;
  }

  get webhookSecret(): string {
    return this.env.STRIPE_WEBHOOK_SECRET;
  }
}
