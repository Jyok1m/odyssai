import { z } from 'zod';
import { normalizeWorkTitle } from './onboarding.js';

/**
 * Un mot qui commence par une majuscule ailleurs qu'en tete de phrase est tenu
 * pour un nom propre. La regle est grossiere et le sait : en francais comme en
 * anglais, presque rien d'autre ne porte la majuscule au milieu d'une phrase.
 *
 * Elle se trompe donc plutot dans le sens du refus, ce qui coute une relance et
 * jamais un monde emprunte. L'apostrophe separe les mots, sans quoi « l'Ordre »
 * passerait pour un seul mot commencant par une minuscule.
 */
const SENTENCE_BREAK = /[.!?…:;]+\s+|\n+/;
const WORD = /\p{L}[\p{L}\p{M}-]*/gu;

export function findProperNouns(text: string): string[] {
  const found = new Set<string>();

  for (const sentence of text.split(SENTENCE_BREAK)) {
    const words = sentence.match(WORD) ?? [];

    words.forEach((word, index) => {
      // En tete de phrase la majuscule ne dit rien.
      if (index === 0) return;
      if (word.length < 2) return;
      if (!/^\p{Lu}/u.test(word)) return;
      found.add(word);
    });
  }

  return [...found];
}

/**
 * Mots de liaison assez longs pour passer le filtre de longueur sans rien
 * designer. Les plus courts tombent d'eux-memes.
 */
const WEAK_WORDS = new Set([
  'dans', 'avec', 'pour', 'sans', 'sous', 'chez', 'entre', 'leur', 'leurs',
  'cette', 'celui', 'celle', 'tout', 'tous', 'toute', 'toutes', 'plus',
  'from', 'with', 'that', 'this', 'into', 'over', 'under', 'their', 'they',
  'other', 'more', 'have', 'been', 'were', 'what', 'when', 'where',
]);

function significantWords(title: string): string[] {
  return normalizeWorkTitle(title)
    .split(' ')
    .filter((word) => word.length >= 4 && !WEAK_WORDS.has(word));
}

/**
 * Dernier etage de la garde : relit un texte genere contre les titres saisis.
 *
 * Seuls les mots portant une majuscule sont compares, la ou `findProperNouns`
 * ignore les tetes de phrase : c'est un nom emprunte que l'on cherche, pas un
 * mot commun. Un lore qui parle d'une rose dans un jardin passe, un lore qui
 * fonde l'ordre de la Rose ne passe pas.
 *
 * Elle attrape les noms, pas les intrigues : un monde qui reprendrait la trame
 * d'une oeuvre sans en citer un seul nom lui echapperait. C'est la passe
 * d'abstraction qui porte cette part la, en ne transmettant que des themes.
 */
export function findBorrowedNames(text: string, works: string[]): string[] {
  const banned = new Map<string, string>();
  for (const title of works) {
    for (const word of significantWords(title)) banned.set(word, title);
  }

  const borrowed = new Set<string>();

  for (const word of text.match(WORD) ?? []) {
    if (!/^\p{Lu}/u.test(word)) continue;
    if (banned.has(normalizeWorkTitle(word))) borrowed.add(word);
  }

  // Un titre entier recopie, meme en minuscules, n'est pas une coincidence.
  // Les titres d'un seul mot en sont exclus : « dune » ou « fondation » sont
  // aussi des mots communs, et les refuser en minuscules interdirait a un monde
  // desertique de parler de sable. Capitalises, ils restent attrapes plus haut.
  //
  // La comparaison porte sur des mots entiers : sans cela « dune » se
  // retrouverait dans « dunes », et le refus tomberait sur une coincidence.
  const haystack = ` ${normalizeWorkTitle(text)} `;
  for (const title of works) {
    const needle = normalizeWorkTitle(title);
    if (needle.includes(' ') && haystack.includes(` ${needle} `)) {
      borrowed.add(title);
    }
  }

  return [...borrowed];
}

/** Prose sans nom propre : c'est l'etage du schema, pas celui du prompt. */
const Prose = (max: number) =>
  z
    .string()
    .trim()
    .min(3)
    .max(max)
    .refine((value) => findProperNouns(value).length === 0, {
      message: 'aucun nom propre',
    });

/**
 * Sortie de la passe d'abstraction, et seule chose que les etapes suivantes de
 * la generation recoivent. Les titres saisis s'arretent avant.
 */
export const WorldThemesSchema = z.object({
  /** Le ton dominant, ce que le monde fait ressentir. */
  tone: Prose(200),
  /** Le cadre physique : ou l'on est, de quoi c'est fait. */
  setting: Prose(400),
  /** Comment le pouvoir se tient, et sur quoi il repose. */
  power: Prose(400),
  /** Ce qui echappe a l'explication, et jusqu'ou. */
  mystery: Prose(400),
  /** Les lignes de fracture dont naissent les histoires. */
  tensions: z.array(Prose(200)).min(2).max(5),
  /** Les motifs qui reviennent : objets, gestes, lieux. */
  motifs: z.array(Prose(120)).min(3).max(8),
  /** Ce que ce monde ne contient pas. Aussi structurant que le reste. */
  forbidden: z.array(Prose(120)).min(1).max(5),
});

export type WorldThemes = z.infer<typeof WorldThemesSchema>;

/** Toute la prose des themes, mise bout a bout pour le controle final. */
export function themesProse(themes: WorldThemes): string {
  return [
    themes.tone,
    themes.setting,
    themes.power,
    themes.mystery,
    ...themes.tensions,
    ...themes.motifs,
    ...themes.forbidden,
  ].join('\n');
}
