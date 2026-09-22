import { ATTRIBUTE_MAX, type Attribute } from '@odyssai/schemas';

/*
  Un attribut monte a l'usage, et c'est le code qui en decide.

  Pas le meneur : un joueur qui insiste finirait par obtenir sa montee, et
  « tu sens que tu progresses » ne coute rien a ecrire. Pas non plus un palier
  accorde a la fin d'un chapitre, puisqu'il n'y a pas de chapitre.

  On progresse donc en pratiquant : chaque jet tranche compte pour l'attribut
  qu'il sollicite, echec compris. Rater est la facon la plus ordinaire
  d'apprendre, et ne compter que les reussites ferait monter le plus fort et
  stagner le plus faible.
*/

/*
  Ce qu'il faut de jets pour passer d'un score au suivant. Plus on est haut,
  plus c'est long : cinq doit rester remarquable, pas une question de patience.

  Les bornes sont larges parce qu'un tour coute un credit. A trois jets pour
  quitter un, un vrai defaut se corrige dans la partie ou il gene ; a quinze
  pour atteindre cinq, personne n'y arrive par accident.
*/
export const PROGRESS_STEPS: Record<number, number> = {
  1: 3,
  2: 6,
  3: 10,
  4: 15,
};

/*
  Le score atteint, ou `null` si rien ne bouge.

  `uses` est le nombre de jets depuis la derniere montee, pas depuis toujours :
  le compteur repart a zero a chaque palier, sans quoi il faudrait rejouer
  toute l'histoire pour savoir ou en est un personnage.
*/
export function grewTo(score: number, uses: number): number | null {
  if (score >= ATTRIBUTE_MAX) return null;

  const needed = PROGRESS_STEPS[score];
  if (needed === undefined || uses < needed) return null;

  return score + 1;
}

// Le compteur d'usages, un par attribut, remis a zero a chaque montee.
export type Progress = Partial<Record<Attribute, number>>;

export function usesAfter(progress: Progress, attribute: Attribute): number {
  return (progress[attribute] ?? 0) + 1;
}

/*
  L'inventaire apres un tour.

  Le modele dit ce qui a change de main, le code decide de ce qui est porte.
  C'est la meme regle que partout : aucun etat n'est deduit du texte, et ce
  bloc de queue est une declaration comme une autre.

  La comparaison est normalisee parce qu'il ecrit « l'epee » la ou il avait
  ecrit « epee corrompue » : ce qui ne se retrouve pas est ignore plutot que
  de faire echouer le tour, comme le reste de `readDelta`.

  Au dela de la borne, l'objet n'entre pas. Faire sortir le plus ancien ferait
  perdre une epee pour trois cailloux, et un sac plein est une situation que
  le joueur comprend mieux qu'une disparition silencieuse.
*/
export function carryAfter(
  current: string[],
  gained: string[],
  lost: string[],
  max: number,
): string[] {
  const fold = (item: string) =>
    item
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();

  const dropped = new Set(lost.map(fold));
  const kept = current.filter((item) => !dropped.has(fold(item)));

  const seen = new Set(kept.map(fold));
  for (const item of gained) {
    if (kept.length >= max) break;
    if (seen.has(fold(item))) continue;
    kept.push(item);
    seen.add(fold(item));
  }

  return kept;
}
