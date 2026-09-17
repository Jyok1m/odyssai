import {
  findBorrowedNames,
  type CanonFact,
  type WorldCharter,
} from '@odyssai/schemas';

/** Pourquoi un fait invente a ete refuse. */
export type CanonRejection =
  | { reason: 'forbidden'; detail: string }
  | { reason: 'borrowed'; detail: string };

export interface CanonVerdict {
  accepted: CanonFact[];
  rejected: { fact: CanonFact; verdict: CanonRejection }[];
}

/**
 * Normalisation minimale, partagee par les deux controles : sans accents, sans
 * ponctuation, en minuscules. La meme idee que `normalizeWorkTitle`, appliquee
 * a des phrases entieres.
 */
function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * La tournure d'un interdit, en francais comme en anglais.
 *
 * Filtrer par longueur serait a l'envers : dans « aucune arme a feu dans ce
 * monde », les mots longs sont « aucune » et « monde », qui ne designent rien,
 * et les porteurs de sens sont « arme » et « feu », courts. C'est donc la
 * grammaire qu'on retire, pas les mots brefs.
 */
const EMPTY_WORDS = new Set([
  'aucun', 'aucune', 'aucuns', 'aucunes', 'nul', 'nulle', 'pas', 'plus',
  'jamais', 'rien', 'sans', 'dans', 'cette', 'monde', 'mondes', 'les', 'des',
  'une', 'del', 'leur', 'leurs', 'avec', 'pour', 'chez', 'sous', 'entre',
  'tout', 'tous', 'toute', 'toutes', 'ici', 'aucunement',
  'none', 'never', 'without', 'this', 'that', 'there', 'world', 'worlds',
  'any', 'anything', 'nothing', 'the', 'and', 'for', 'with', 'here',
]);

function meaningfulWords(text: string): string[] {
  return fold(text)
    .split(' ')
    .filter((word) => word.length >= 3 && !EMPTY_WORDS.has(word));
}

/**
 * Un interdit de la charte est contredit quand le fait reprend assez de ses
 * mots porteurs pour parler de la meme chose.
 *
 * La regle est grossiere et le sait. Elle se trompe dans le sens du refus :
 * un fait refuse a tort coute une phrase au meneur, un fait accepte a tort
 * ouvre dans le monde une porte que sa charte disait fermee, et plus rien ne
 * la referme ensuite puisque le canon nourrit tous les tours suivants.
 */
function contradicts(statement: string, forbidden: string): boolean {
  const words = meaningfulWords(forbidden);
  if (words.length === 0) return false;

  const haystack = ` ${fold(statement)} `;
  const hits = words.filter((word) => haystack.includes(` ${word} `)).length;

  return hits >= Math.min(2, words.length);
}

/**
 * Le canon grandit a chaque question hors lore, donc la garde sur les emprunts
 * doit grandir avec lui : ce qui a ete refuse a la generation ne doit pas
 * rentrer par une reponse du meneur trois cents tours plus tard.
 */
export function arbitrateCanon(
  facts: CanonFact[],
  charter: WorldCharter,
  works: string[],
): CanonVerdict {
  const verdict: CanonVerdict = { accepted: [], rejected: [] };

  for (const fact of facts) {
    const text = `${fact.subject} ${fact.statement}`;

    const borrowed = findBorrowedNames(text, works);
    if (borrowed.length > 0) {
      verdict.rejected.push({
        fact,
        verdict: { reason: 'borrowed', detail: borrowed.join(', ') },
      });
      continue;
    }

    const broken = charter.forbidden.find((rule) => contradicts(text, rule));
    if (broken) {
      verdict.rejected.push({
        fact,
        verdict: { reason: 'forbidden', detail: broken },
      });
      continue;
    }

    verdict.accepted.push(fact);
  }

  return verdict;
}
