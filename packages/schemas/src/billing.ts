import { z } from 'zod';

/**
 * Les plans, dupliques ici du moteur parce que `packages/schemas` ne depend de
 * rien : c'est le contrat entre l'api et le navigateur, et un contrat ne doit
 * pas trainer derriere lui les regles du jeu.
 */
export const PlanIdSchema = z.enum(['free', 'apprenti', 'arpenteur']);

export type PlanId = z.infer<typeof PlanIdSchema>;

/** Ce que l'ecran de compte affiche de la reserve. */
export const BillingSummarySchema = z.object({
  plan: PlanIdSchema,
  /** active, canceled, past_due, incomplete... tel que Stripe le dit. */
  status: z.string(),
  credits: z.number().int().nonnegative(),
  /** La dotation de la periode, pour dessiner une jauge. */
  monthly: z.number().int().nonnegative(),
  /** Fin de la periode en cours, ISO 8601. */
  renewsAt: z.iso.datetime(),
  cancelAtPeriodEnd: z.boolean(),
  /**
   * Faux quand Stripe n'est pas configure. L'ecran cache alors la vente au
   * lieu de proposer un bouton qui repondrait 503.
   */
  purchasable: z.boolean(),
});

export type BillingSummary = z.infer<typeof BillingSummarySchema>;

/** Le bareme publie, pour que le joueur sache ce que coute une action. */
export const CreditPriceSchema = z.object({
  turn: z.number().int().nonnegative(),
  characterMessage: z.number().int().nonnegative(),
  worldGeneration: z.number().int().nonnegative(),
});

export type CreditPrice = z.infer<typeof CreditPriceSchema>;

/** Les plans payants seulement : on ne souscrit pas au palier libre. */
export const CheckoutRequestSchema = z.object({
  plan: z.enum(['apprenti', 'arpenteur']),
});

export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

/**
 * Une redirection, jamais un formulaire de carte. La saisie reste chez Stripe :
 * l'heberger nous ferait entrer dans le perimetre PCI sans rien apporter.
 */
export const BillingRedirectSchema = z.object({
  url: z.url(),
});

export type BillingRedirect = z.infer<typeof BillingRedirectSchema>;
