import { z } from 'zod';

/**
 * Le slug d'un palier.
 *
 * Plus une enumeration fermee : les paliers se creent depuis le tableau de
 * bord d'administration, et leurs slugs ne sont donc pas connus a la
 * compilation. La forme reste bornee, elle voyage dans des URL et se relit
 * dans des journaux.
 */
export const PlanSlugSchema = z
  .string()
  .min(2)
  .max(24)
  .regex(/^[a-z][a-z0-9-]*$/, 'minuscules, chiffres et tirets, commencant par une lettre');

export type PlanSlug = z.infer<typeof PlanSlugSchema>;

/** Ce que l'ecran de compte affiche de la reserve. */
export const BillingSummarySchema = z.object({
  plan: PlanSlugSchema,
  /** Le nom affiche du palier, choisi par l'administrateur. */
  planName: z.string(),
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
  /**
   * Vrai des qu'un espace de facturation existe chez Stripe.
   *
   * Distinct de `purchasable`, qui dit si l'on peut acheter : un joueur
   * revenu au palier libre apres une resiliation n'a plus d'abonnement mais
   * garde ses factures, et doit pouvoir les relire. Lier le bouton au palier
   * courant les lui cachait.
   */
  manageable: z.boolean().default(false),
  /**
   * Vrai pour un administrateur, dont la reserve ne se debite jamais.
   *
   * Sans ce champ l'ecran afficherait un solde immobile et une jauge pleine,
   * ce qui se lit comme un compteur casse. Il ne donne aucun droit : c'est
   * `CreditsService` qui n'en preleve pas, et `AdminGuard` qui refuse.
   *
   * Absent, il vaut faux : les deux images basculent l'une apres l'autre.
   */
  unlimited: z.boolean().default(false),
});

export type BillingSummary = z.infer<typeof BillingSummarySchema>;

/** Le bareme publie, pour que le joueur sache ce que coute une action. */
export const CreditCostsSchema = z.object({
  turn: z.number().int().nonnegative(),
  characterMessage: z.number().int().nonnegative(),
  worldGeneration: z.number().int().nonnegative(),
});

export type CreditCosts = z.infer<typeof CreditCostsSchema>;

export const PlanOfferSchema = z.object({
  id: PlanSlugSchema,
  name: z.string(),
  /** Credits rendus a chaque periode. Zero sur un palier qui ne renouvelle pas. */
  monthly: z.number().int().nonnegative(),
  /**
   * Credits accordes une seule fois, a l'ouverture du compte.
   *
   * Publie parce que les paliers offerts ne tiennent que par lui : Founder et
   * Rider ont une dotation mensuelle nulle, et une page de tarifs qui ne
   * lirait que `monthly` annoncerait zero credit sur les deux seuls paliers
   * qu'un visiteur peut essayer.
   */
  welcome: z.number().int().nonnegative(),
  /**
   * Ce que Stripe facture, en centimes, ou null pour un palier offert. Copie
   * pour l'affichage : la verite du montant reste le prix Stripe.
   */
  amountCents: z.number().int().nonnegative().nullable(),
  currency: z.string().length(3),
  /**
   * Faux tant que le prix du plan n'est pas configure chez Stripe, et faux
   * aussi quand l'administrateur l'a mis en attente. L'ecran annonce alors le
   * palier sans proposer un bouton qui echouerait.
   */
  purchasable: z.boolean(),
  /**
   * Le palier mis en avant. Un seul a la fois, la base le garantit.
   *
   * Une donnee et non un calcul : « celui du milieu parmi les payants » etait
   * juste avec trois paliers et faux au quatrieme, et personne ne pouvait le
   * changer sans deploiement.
   */
  recommended: z.boolean().default(false),
  /** Annonce mais pas encore en vente, par decision et non par defaut de configuration. */
  comingSoon: z.boolean().default(false),
});

export type PlanOffer = z.infer<typeof PlanOfferSchema>;

/**
 * Ce qui se vend et ce que cela coute, servi sans session : le bareme n'a rien
 * de personnel, et la page de tarifs doit pouvoir s'afficher avant de
 * s'inscrire.
 */
export const BillingCatalogSchema = z.object({
  costs: CreditCostsSchema,
  plans: z.array(PlanOfferSchema),
});

export type BillingCatalog = z.infer<typeof BillingCatalogSchema>;

/** L'API refuse le palier offert et tout palier archive : elle seule sait. */
export const CheckoutRequestSchema = z.object({
  plan: PlanSlugSchema,
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
