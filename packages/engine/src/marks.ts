import { MARKS_MAX, type Mark, type MarkKind } from '@odyssai/schemas';

/*
  Ce qu'on rapporte d'un monde.

  Pas une epee : une cicatrice, une peur, une conviction. Ce qu'on vit
  ailleurs change qui est le personnage, pas ce qu'il possede, et c'est ce qui
  garde chaque monde equilibre.

  Le declencheur est du code, jamais une declaration du meneur. Une marque
  qu'il accorderait finirait par s'accorder a celui qui la demande, comme la
  montee d'attribut : elle se gagne dans ce qui est arrive, pas dans ce qu'on
  a raconte.
*/

export interface MarkTrigger {
  // Le personnage vient de tomber, et ne l'etait pas au tour d'avant.
  fell: boolean;
  // L'acte en cours vient de s'achever.
  actClosed: boolean;
  // Ce qu'il porte deja.
  marks: number;
}

/*
  Le genre de marque que ce tour laisse, ou `null`.

  Une seule par tour : deux d'un coup seraient deux lignes qui racontent le
  meme moment. Tomber passe avant, parce que c'est le corps qui se souvient le
  plus fort.

  `peur` est dans le vocabulaire et n'a pas de declencheur : aucun evenement
  que le code voit ne la distingue d'une cicatrice sans devenir si frequent
  que la fiche s'en remplirait. Elle attend un jeu qui saura la reconnaitre.
*/
export function markFor(trigger: MarkTrigger): MarkKind | null {
  if (trigger.marks >= MARKS_MAX) return null;
  if (trigger.fell) return 'cicatrice';
  if (trigger.actClosed) return 'conviction';
  return null;
}

/*
  La liste apres une marque de plus. Bornee comme l'inventaire, et par le
  meme raisonnement : au dela, l'ancienne ne se lit plus, mais elle ne se
  perd pas pour autant, c'est la nouvelle qui n'entre pas.
*/
export function marksAfter(current: Mark[], added: Mark): Mark[] {
  return current.length >= MARKS_MAX ? current : [...current, added];
}
