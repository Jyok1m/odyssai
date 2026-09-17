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

export const PLANS = ['free', 'apprenti', 'arpenteur'] as const;

export type PlanId = (typeof PLANS)[number];

export interface Plan {
  id: PlanId;
  /** Credits rendus a chaque periode. */
  monthly: number;
  /**
   * Accorde une seule fois, a l'ouverture du compte. Couvre la generation du
   * premier monde : c'est ce qui permet de voir ce qu'on achete avant de
   * payer.
   */
  welcome: number;
  /** Faux pour le palier libre, qui n'a pas de prix chez Stripe. */
  billed: boolean;
}

/**
 * Les plans vivent en code, leurs prix chez Stripe, et l'appariement passe par
 * des variables d'environnement : les identifiants de prix different entre le
 * mode test et la production, et une table en base rendrait la base propre a
 * un environnement.
 *
 * Les montants des plans payants sont des points de depart, a recaler sur ce
 * que `llm_usage` montrera d'un vrai mois de jeu.
 */
export const PLAN_BY_ID: Record<PlanId, Plan> = {
  free: { id: 'free', monthly: 30, welcome: CREDIT_COSTS.worldGeneration, billed: false },
  apprenti: { id: 'apprenti', monthly: 300, welcome: 0, billed: true },
  arpenteur: { id: 'arpenteur', monthly: 1000, welcome: 0, billed: true },
};

export function planOf(id: string): Plan {
  return PLAN_BY_ID[id as PlanId] ?? PLAN_BY_ID.free;
}

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
