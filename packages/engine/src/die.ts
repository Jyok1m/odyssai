import { randomInt } from 'node:crypto';

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
