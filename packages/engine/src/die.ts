import { randomInt } from 'node:crypto';
import type { Attribute } from '@odyssai/schemas';

/*
  Lance par le code, jamais par le modele, qui tirerait ce qui arrange son
  recit. `randomInt` et non `Math.random` : sans biais modulo, et l'equite
  d'un de ne doit pas avoir a se redemontrer.
*/
export const DIE_FACES = 20;

export function rollD20(): number {
  return randomInt(1, DIE_FACES + 1);
}

/*
  Les bandes, de la pire a la meilleure. C'est tout ce que le modele recoit :
  il narre une issue, il ne lit pas un chiffre.
*/
export const OUTCOME_BANDS = [
  'echec_critique',
  'echec',
  'partiel',
  'succes',
  'succes_critique',
] as const;

export type OutcomeBand = (typeof OUTCOME_BANDS)[number];

/*
  Bornes classiques d'un d20. Le 1 et le 20 sont seuls dans leur bande : ce
  sont les deux moments ou l'histoire a le droit de basculer.
*/
export function bandOf(roll: number): OutcomeBand {
  if (!Number.isInteger(roll) || roll < 1 || roll > DIE_FACES) {
    throw new RangeError(`jet hors du de : ${roll}`);
  }

  if (roll === 1) return 'echec_critique';
  if (roll === DIE_FACES) return 'succes_critique';
  if (roll <= 9) return 'echec';
  if (roll <= 14) return 'partiel';
  return 'succes';
}

// Ce que le joueur voit. Deux etats, et rien de plus.
export type PublicOutcome = 'favorable' | 'defavorable';

/*
  Un succes partiel est annonce favorable : le joueur obtient quelque chose.
  La nuance appartient au recit, qui est le seul endroit ou elle se lit.
*/
export function publicOutcome(band: OutcomeBand): PublicOutcome {
  return band === 'echec' || band === 'echec_critique'
    ? 'defavorable'
    : 'favorable';
}

/*
  Les situations dont l'issue se tranche au de.

  C'est le code qui decide, comme il decide du lancer : laisser le modele juger
  de l'incertitude revenait a lui laisser le de. Mesure sur douze tours, il ne
  s'en servait qu'une fois, et racontait une reussite sur une bande d'echec.

  La liste est volontairement courte : un geste qui peut rater et dont l'echec
  change quelque chose. Une question sur le monde, un deplacement ou une
  confidence n'ont rien a trancher.
*/
const SETTLED_BY_DIE = new Set<string>([
  'violence',
  'contrainte',
  'tromperie',
  'entreprise',
]);

export function settledByDie(situation: string | null): boolean {
  return situation !== null && SETTLED_BY_DIE.has(situation);
}

/*
  Ce qu'un jet sollicite, par situation.

  Le code le decide, comme il decide du lancer et de l'usage : demander au
  modele quel attribut s'applique reviendrait a le laisser choisir celui qui
  arrange son recit, et il choisirait le plus haut.

  `instinct` n'y figure pas encore : aucune des situations qui tranchent ne
  l'appelle. Il se lit sur la fiche et nourrit le recit, sans etre calcule.
*/
const TESTED_BY: Record<string, Attribute> = {
  violence: 'corps',
  contrainte: 'presence',
  tromperie: 'adresse',
  entreprise: 'esprit',
};

export function attributeFor(situation: string | null): Attribute | null {
  return situation === null ? null : (TESTED_BY[situation] ?? null);
}

/*
  Le modificateur d'un score, de -2 a +2 sur une echelle de un a cinq.

  Trois est le milieu, donc l'absence de bonus : un personnage moyen lance un
  de nu. Deux points d'ecart sur un vingt valent dix pour cent de chances,
  assez pour qu'une force se sente sans qu'elle decide a la place du de.
*/
export function modifierOf(score: number): number {
  return score - 3;
}

/*
  La bande d'un jet, modificateur compris.

  Le total est borne aux faces du de plutot que de le laisser deborder :
  `bandOf` refuse ce qui n'est pas un jet valide, et c'est bien qu'elle le
  refuse. Consequence assumee, un bonus peut porter un dix-neuf au critique,
  et un malus enfoncer un deux dans l'echec critique : une force et une
  faiblesse doivent pouvoir decider d'un bord.
*/
export function bandFor(roll: number, modifier: number): OutcomeBand {
  const total = Math.min(DIE_FACES, Math.max(1, roll + modifier));
  return bandOf(total);
}
