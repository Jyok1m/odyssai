/**
 * Le bareme, en credits.
 *
 * Le joueur achete des credits, pas des jetons : « il te reste 43 200 jetons »
 * ne veut rien dire pour quelqu'un qui joue, et un monde bavard viderait sa
 * reserve sans qu'il comprenne pourquoi. Un tour vaut un credit, et tout se
 * compare a cela.
 *
 * Le rapport entre un credit et son cout reel se regle ici, sans toucher a
 * Stripe : les prix vendus ne bougent pas quand le modele change.
 *
 * Le bareme reste en code parce que c'est une regle de jeu : ce qu'un tour
 * coute en credits ne se negocie pas par client. Les paliers, eux, vivent en
 * base et s'editent depuis le tableau de bord d'administration.
 */
export const CREDIT_COSTS = {
  /** L'unite de reference. */
  turn: 1,
  /** Meme ordre de cout qu'un tour. */
  characterMessage: 1,
  /** Sept appels au mieux, vingt-trois au pire. C'est le gros poste. */
  worldGeneration: 25,
  /** Une fois par partie, negligeable. */
  characterExtract: 0,
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;

/**
 * La moderation et les embeddings ne sont jamais factures. Faire payer au
 * joueur le fait qu'on le surveille serait indefendable, et le rappel de sa
 * propre histoire n'est pas un service qu'il commande.
 */
export function creditsFor(action: CreditAction): number {
  return CREDIT_COSTS[action];
}

/**
 * Le palier offert. Son slug est une constante du moteur et non une donnee :
 * c'est celui sur lequel un joueur retombe quand son abonnement s'arrete, et
 * il doit exister meme si le tableau de bord d'administration a fait le
 * menage. La table le protege donc de l'archivage et de la suppression.
 */
export const FREE_PLAN_SLUG = 'free';

/**
 * Le bonus des premiers arrives.
 *
 * Ce n'est pas un palier : un palier se choisit, celui-ci s'attribue. Le
 * mettre dans `plans` obligeait la page de tarifs a montrer une offre que
 * personne ne pouvait prendre.
 *
 * Le rang se lit sur la date d'inscription, et non sur un compteur : un
 * compteur se desynchronise, une date se relit. Les administrateurs ne sont
 * pas comptes dans les cent places, ils n'ont pas a prendre la place d'un
 * joueur.
 */
export const FOUNDER_BONUS = {
  /** Les cent premiers joueurs, administrateurs non compris. */
  rank: 100,
  credits: 30,
} as const;

/**
 * Bornes d'un palier, appliquees a la creation comme a la modification.
 *
 * Une dotation negative rendrait un solde negatif ; une dotation demesuree
 * viderait le budget sans qu'aucune limite ne s'y oppose. Ces bornes ne sont
 * pas une opinion sur le prix, seulement le domaine de ce qui a un sens.
 */
export const PLAN_LIMITS = {
  monthlyCreditsMax: 1_000_000,
  welcomeCreditsMax: 1_000_000,
  /** Cinquante centimes : en dessous, les frais fixes de Stripe mangent tout. */
  amountCentsMin: 50,
  amountCentsMax: 1_000_000,
} as const;

/**
 * La periode suivante, un mois apres celle en cours.
 *
 * Le renouvellement suit la date d'ancrage, pas le calendrier : un abonne du
 * 20 ne doit pas voir sa reserve repartir le 1er. Pour un abonnement paye,
 * l'ancre vient de la facture Stripe ; pour le palier libre, de la creation
 * du compte.
 *
 * Le 31 d'un mois qui n'en a que 30 retombe sur le dernier jour, plutot que de
 * deborder sur le mois suivant comme le ferait `setMonth` seul.
 */
export function nextPeriod(from: Date): Date {
  const next = new Date(from);
  const day = next.getUTCDate();

  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);

  const last = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();

  next.setUTCDate(Math.min(day, last));
  return next;
}
