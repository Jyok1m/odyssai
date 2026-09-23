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
  /*
    Une question au meneur : le meme appel qu'un tour, donc le meme cout.

    C'est un curseur assume et non une evidence. La mettre a zero ouvrirait un
    canal vers le modele que seules les limites horaires borneraient ; la
    laisser a un decourage exactement ce qu'on veut encourager, un joueur qui
    demande plutot qu'un joueur qui subit. Elle se baisse ici, sans rien
    toucher d'autre.
  */
  question: 1,
  /*
    La replique d'un personnage par le modele de jeu de role, quand le joueur
    s'adresse a quelqu'un. Fondue dans le tour : treize milliards de
    parametres pour trois phrases, un dixieme du meneur. Le curseur existe
    pour le jour ou ce ne serait plus vrai.
  */
  dialogue: 0,
  /*
    Un fragment de lore, pour une entite que le meneur vient de poser. Un
    appel de plus par entite, au plus deux par tour : c'est le prix de la
    coherence, et il se voit sur la facture plutot que d'etre fondu dans le
    tour. Sans reserve, le tour se joue et l'entite reste sans histoire.
  */
  lore: 1,
  /*
    Une marque rapportee : une ligne ecrite par le modele quand le personnage
    tombe ou qu'un acte s'acheve. Rare par construction, et bornee a six par
    essence : elle ne peut pas devenir un poste de depense.
  */
  mark: 1,
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
