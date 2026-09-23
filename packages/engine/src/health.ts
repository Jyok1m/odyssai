import { CONDITIONS, type Condition } from '@odyssai/schemas';
import type { OutcomeBand } from './die.js';

/*
  Les points de vie, tenus par le code.

  C'est la seule jauge que le moteur peut tenir honnetement, et elle existe
  pour une raison precise : sans elle, c'est le recit qui decide si le joueur
  est blesse ou mort. « Le LLM narre, le code decide » ne souffre pas
  d'exception pour la vie du personnage.

  Ni mana ni niveau ni points d'experience a cote : le mana n'a de sens que
  dans un monde qui a de la magie, et c'est la charte qui le dit, pas le
  moteur ; l'experience, elle, existe deja, par attribut et a l'usage.
*/

/*
  La reserve, derivee de `corps` : dix points, plus deux par cran. De douze a
  vingt, donc quatre a cinq mauvais echanges avant de tomber. Un dur a cuire
  tient une passe de plus qu'un frele, pas trois.
*/
export const HP_BASE = 10;
export const HP_PER_CORPS = 2;

export function hpMaxOf(corps: number): number {
  return HP_BASE + corps * HP_PER_CORPS;
}

/*
  Ce qu'un echange coute, par bande.

  Le de decide, comme il decide du reste : le meneur ne declare aucun degat,
  et ne peut donc ni epargner un joueur qui insiste, ni l'achever pour la
  beaute de la scene. Un succes partiel coute un point : on l'emporte, mais on
  le sent passer.
*/
const HARM: Record<OutcomeBand, number> = {
  echec_critique: 4,
  echec: 2,
  partiel: 1,
  succes: 0,
  succes_critique: 0,
};

/*
  Les situations qui peuvent blesser. Elles sont physiques, et elles sont un
  sous-ensemble de celles que le de tranche : rater un mensonge coute une
  reputation, pas du sang.
*/
const HARMFUL = new Set<string>(['violence', 'contrainte']);

export function harmFor(situation: string | null, band: OutcomeBand): number {
  if (situation === null || !HARMFUL.has(situation)) return 0;
  return HARM[band];
}

/*
  Ce qu'il faut de tours sans coup recu pour regagner un point.

  Il n'y a pas d'horloge dans ce jeu : le temps s'y mesure en tours, et le
  repos aussi. Trois tours calmes pour un point rendu remet un personnage
  d'aplomb en une scene ou deux, sans jamais annuler un echec critique dans la
  foulee.
*/
export const REST_STEP = 3;

export interface Vitals {
  hp: number;
  // Tours calmes depuis le dernier point rendu, remis a zero a chaque coup.
  rest: number;
}

/*
  L'etat apres un tour : le coup recu, sinon le repos qui avance.

  Remonter depuis zero est permis, et c'est voulu : un personnage a terre n'est
  pas mort, il est hors de combat, et le monde continue autour de lui. Le
  moteur ne tue pas le joueur, et rien dans cette fonction ne le peut.
*/
export function vitalsAfter(
  current: Vitals,
  hpMax: number,
  harm: number,
): Vitals {
  if (harm > 0) {
    return { hp: Math.max(0, current.hp - harm), rest: 0 };
  }

  if (current.hp >= hpMax) return { hp: hpMax, rest: 0 };

  const rest = current.rest + 1;
  return rest >= REST_STEP ? { hp: current.hp + 1, rest: 0 } : { hp: current.hp, rest };
}

/*
  Le mot que le meneur recoit, et le seul. Quatre crans : la jauge est au
  joueur, la nuance au recit.
*/
export function conditionOf(hp: number, hpMax: number): Condition {
  if (hp <= 0) return 'a_terre';
  if (hp >= hpMax) return 'indemne';
  return hp * 2 > hpMax ? 'blesse' : 'mal_en_point';
}

// Reexporte pour que l'index des reglages n'ait pas a connaitre les schemas.
export { CONDITIONS };
export type { Condition };
