/*
  Le bareme, en credits et non en jetons : un tour vaut un credit, et tout se
  compare a cela. Le rapport entre un credit et son cout reel se regle ici,
  sans toucher a Stripe.

  En code parce que c'est une regle de jeu, quand les paliers, eux, vivent en
  base et s'editent au tableau de bord.
*/
export const CREDIT_COSTS = {
  // L'unite de reference.
  turn: 1,
  // Meme ordre de cout qu'un tour.
  characterMessage: 1,
  // Sept appels au mieux, vingt-trois au pire. C'est le gros poste.
  worldGeneration: 25,
  // Une fois par partie, negligeable.
  characterExtract: 0,
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;

/*
  La moderation et les embeddings ne sont jamais factures. Faire payer au
  joueur le fait qu'on le surveille serait indefendable, et le rappel de sa
  propre histoire n'est pas un service qu'il commande.
*/
export function creditsFor(action: CreditAction): number {
  return CREDIT_COSTS[action];
}

/*
  Le palier offert. Son slug est une constante du moteur et non une donnee :
  c'est celui sur lequel un joueur retombe quand son abonnement s'arrete, et
  il doit exister meme si le tableau de bord d'administration a fait le
  menage. La table le protege donc de l'archivage et de la suppression.
*/
export const FREE_PLAN_SLUG = 'free';

/*
  Le bonus des premiers arrives. Pas un palier : un palier se choisit, celui-ci
  s'attribue, et dans `plans` il forcait la page de tarifs a montrer une offre
  que personne ne pouvait prendre. Le rang se lit sur la date d'inscription,
  un compteur se desynchronisant.
*/
export const FOUNDER_BONUS = {
  // Les cent premiers joueurs, administrateurs non compris.
  rank: 100,
  credits: 30,
} as const;

/*
  Les places de l'alpha fermee. Au dela, l'api refuse de provisionner : le
  realm n'etant pas pilote d'ici, Keycloak peut creer un compte sans joueur
  derriere.

  Le meme nombre que le rang fondateur, ce sont les memes personnes, mais deux
  constantes : ouvrir les portes ne doit pas retirer leur bonus aux premiers.
  Les administrateurs ne prennent pas de place.
*/
export const ALPHA_SEATS = 100;

/*
  Bornes d'un palier, appliquees a la creation comme a la modification.

  Une dotation negative rendrait un solde negatif ; une dotation demesuree
  viderait le budget sans qu'aucune limite ne s'y oppose. Ces bornes ne sont
  pas une opinion sur le prix, seulement le domaine de ce qui a un sens.
*/
export const PLAN_LIMITS = {
  monthlyCreditsMax: 1_000_000,
  welcomeCreditsMax: 1_000_000,
  // Cinquante centimes : en dessous, les frais fixes de Stripe mangent tout.
  amountCentsMin: 50,
  amountCentsMax: 1_000_000,
} as const;

/*
  La periode suivante suit la date d'ancrage, pas le calendrier : un abonne du
  20 ne voit pas sa reserve repartir le 1er. Le 31 d'un mois qui n'en a que 30
  retombe sur le dernier jour, la ou `setMonth` seul deborderait.
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
