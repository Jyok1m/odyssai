import { z } from 'zod';
import { PlanSlugSchema } from './billing.js';

/**
 * Contrats du tableau de bord d'administration.
 *
 * Tout ce qui est ici passe par `AdminGuard` et ne sort jamais vers un joueur.
 * L'adresse e-mail y figure, ce qui n'est le cas d'aucune autre projection :
 * c'est le seul moyen de reconnaitre quelqu'un qui n'a pas pris de pseudo.
 */

/** Un joueur, tel que la liste l'affiche. */
export const AdminUserRowSchema = z.object({
  id: z.uuid(),
  username: z.string().nullable(),
  email: z.string(),
  emailVerified: z.boolean(),
  isAdmin: z.boolean(),
  locale: z.enum(['fr', 'en']),
  createdAt: z.iso.datetime(),
  lastLoginAt: z.iso.datetime().nullable(),

  plan: PlanSlugSchema,
  planName: z.string(),
  /** active, canceled, past_due... tel que Stripe le dit. */
  status: z.string(),
  credits: z.number().int(),
  monthly: z.number().int().nonnegative(),
  renewsAt: z.iso.datetime(),
  cancelAtPeriodEnd: z.boolean(),
  /** Vrai des que le joueur paie : un lien vers Stripe devient utile. */
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
});

export type AdminUserRow = z.infer<typeof AdminUserRowSchema>;

/**
 * Pagination par curseur et non par numero de page : la liste s'allonge
 * pendant qu'on la lit, et un decalage ferait sauter ou repeter des lignes.
 */
export const AdminUserPageSchema = z.object({
  rows: z.array(AdminUserRowSchema),
  nextCursor: z.string().nullable(),
});

export type AdminUserPage = z.infer<typeof AdminUserPageSchema>;

/** Une ligne du grand livre, pour l'historique d'un joueur. */
export const AdminCreditEntrySchema = z.object({
  id: z.uuid(),
  delta: z.number().int(),
  reason: z.string(),
  ref: z.string().nullable(),
  balance: z.number().int(),
  createdAt: z.iso.datetime(),
});

export type AdminCreditEntry = z.infer<typeof AdminCreditEntrySchema>;

export const AdminUserDetailSchema = AdminUserRowSchema.extend({
  entries: z.array(AdminCreditEntrySchema),
  /** Ce que le joueur a coute en appels au modele, en dollars. */
  spentUsd: z.number().nonnegative(),
  worldCount: z.number().int().nonnegative(),
  turnCount: z.number().int().nonnegative(),
});

export type AdminUserDetail = z.infer<typeof AdminUserDetailSchema>;

/**
 * Poser un solde, ou le deplacer.
 *
 * `set` ecrit l'ecart au grand livre, il ne le contourne pas : le grand livre
 * reste en ajout seul, et un solde remis a zero doit se lire comme un
 * mouvement, pas comme un trou.
 */
export const AdjustCreditsRequestSchema = z.object({
  mode: z.enum(['set', 'add']),
  credits: z.number().int().min(-1_000_000).max(1_000_000),
  /** Visible dans le grand livre. Dire pourquoi n'est pas facultatif. */
  note: z.string().min(3).max(140),
});

export type AdjustCreditsRequest = z.infer<typeof AdjustCreditsRequestSchema>;

/** Un palier, tel que le tableau de bord l'edite. */
export const AdminPlanSchema = z.object({
  id: z.uuid(),
  slug: PlanSlugSchema,
  name: z.string(),
  monthlyCredits: z.number().int().nonnegative(),
  welcomeCredits: z.number().int().nonnegative(),
  amountCents: z.number().int().nonnegative().nullable(),
  currency: z.string().length(3),
  stripeProductId: z.string().nullable(),
  stripePriceId: z.string().nullable(),
  archived: z.boolean(),
  recommended: z.boolean(),
  comingSoon: z.boolean(),
  sortOrder: z.number().int(),
  /** Combien de joueurs le portent. Un palier porte ne se supprime pas. */
  subscriberCount: z.number().int().nonnegative(),
  /** Faux pour le palier offert, que rien ne doit pouvoir retirer. */
  removable: z.boolean(),
  createdAt: z.iso.datetime(),
});

export type AdminPlan = z.infer<typeof AdminPlanSchema>;

const Name = z.string().min(2).max(64);
const Credits = z.number().int().min(0).max(1_000_000);

/**
 * Un montant absent cree un palier offert, sans rien chez Stripe. Sinon le
 * produit et le prix sont crees la-bas, et l'identifiant revient ici.
 */
export const CreatePlanRequestSchema = z.object({
  slug: PlanSlugSchema,
  name: Name,
  monthlyCredits: Credits,
  welcomeCredits: Credits.default(0),
  amountCents: z.number().int().min(50).max(1_000_000).nullable().default(null),
  currency: z.string().length(3).default('eur'),
  sortOrder: z.number().int().min(0).max(999).default(0),
  comingSoon: z.boolean().default(false),
});

export type CreatePlanRequest = z.infer<typeof CreatePlanRequestSchema>;

/**
 * Le slug ne se modifie pas : il est ecrit dans chaque abonnement et dans le
 * grand livre, et le changer reecrirait l'histoire.
 *
 * Changer `amountCents` cree un nouveau prix chez Stripe et archive l'ancien,
 * un prix y etant immuable. Les abonnes en cours gardent le leur jusqu'a leur
 * prochaine facture : Stripe ne rejoue pas un abonnement sur un nouveau prix.
 */
export const UpdatePlanRequestSchema = z.object({
  name: Name.optional(),
  monthlyCredits: Credits.optional(),
  welcomeCredits: Credits.optional(),
  amountCents: z.number().int().min(50).max(1_000_000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  archived: z.boolean().optional(),
  /**
   * Un seul palier recommande a la fois : poser celui-ci retire le precedent,
   * dans la meme transaction. La base porte la contrainte, le service se
   * contente de ne pas la heurter.
   */
  recommended: z.boolean().optional(),
  comingSoon: z.boolean().optional(),
});

export type UpdatePlanRequest = z.infer<typeof UpdatePlanRequestSchema>;

/** Les chiffres de la page d'accueil du tableau de bord. */
export const AdminOverviewSchema = z.object({
  users: z.number().int().nonnegative(),
  usersWithUsername: z.number().int().nonnegative(),
  paying: z.number().int().nonnegative(),
  worlds: z.number().int().nonnegative(),
  turnsLast30Days: z.number().int().nonnegative(),
  creditsOutstanding: z.number().int(),
  spentUsdLast30Days: z.number().nonnegative(),
  byPlan: z.array(
    z.object({
      plan: PlanSlugSchema,
      planName: z.string(),
      subscribers: z.number().int().nonnegative(),
    }),
  ),
  /** Faux sans cle Stripe : le tableau de bord cache alors ce qu'il ne peut pas faire. */
  stripeEnabled: z.boolean(),
  stripeLive: z.boolean(),
});

export type AdminOverview = z.infer<typeof AdminOverviewSchema>;

export const AdminErrorBodySchema = z.object({
  code: z.enum([
    'forbidden',
    'not_found',
    'slug_taken',
    'plan_in_use',
    'plan_protected',
    'billing_disabled',
    'stripe_error',
    'validation_error',
  ]),
  message: z.string().optional(),
});

export type AdminErrorBody = z.infer<typeof AdminErrorBodySchema>;
