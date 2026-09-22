/*
  Premiere couche : lexicale, instantanee, gratuite. Elle attrape le manifeste
  sans appel reseau, le discernement appartenant au classificateur.

  La liste est courte et assumee : l'allonger donnerait l'illusion d'une
  protection en multipliant les faux positifs.
*/

/*
  Ce qui sert a ecrire une insulte en la deguisant. La normalisation defait
  chacun de ces procedes avant de comparer : sans elle, « c0nn4rd » passerait
  et la liste ne servirait a rien.
*/
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
};

function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split('')
    .map((char) => LEET[char] ?? char)
    .join('');
}

/*
  L'etirement seul est defait : trois lettres identiques ou plus tombent a
  une, un doublement reste intact. A deux, « faggot » deviendrait « fagot », un
  mot courant. Aucun mot n'a trois fois la meme lettre de suite.
*/
const squash = (text: string): string => text.replace(/(\p{L})\1{2,}/gu, '$1');

// Forme en mots : les separateurs deviennent des espaces.
export function normalizeForModeration(text: string): string {
  return squash(fold(text).replace(/[^\p{L}\p{N}]+/gu, ' ')).trim();
}

/*
  Les mots epeles : « c.o.n.n.a.r.d ». Seules les suites d'au moins quatre
  lettres isolees sont recollees, tout coller revenant a chercher en
  sous-chaine, ce qui faisait tomber « batardeau » et « salopette ». Quatre
  lettres seules de suite signent un contournement, pas une phrase.
*/
const SPELLED_MIN = 4;

function spelledWords(words: string[]): string[] {
  const found: string[] = [];
  let run: string[] = [];

  const flush = () => {
    if (run.length >= SPELLED_MIN) found.push(run.join(''));
    run = [];
  };

  for (const word of words) {
    if (word.length === 1) run.push(word);
    else flush();
  }
  flush();

  return found;
}

/*
  Racines d'insultes et de slurs, en francais et en anglais. Comparees sur des
  mots entiers ou sur un prefixe suivi d'une terminaison, jamais en
  sous-chaine : « connard » ne doit pas faire tomber « reconnaitre ».
*/
const SLUR_ROOTS = [
  'connard', 'connasse', 'enculer', 'encule', 'salope', 'pute', 'putain',
  'batard', 'pd', 'pede', 'tapette', 'negre', 'bougnoule', 'youpin',
  'bicot', 'chintok', 'niquer', 'nique', 'ntm', 'fdp', 'tg',
  'fuck', 'fucking', 'cunt', 'bitch', 'whore', 'faggot',
  'nigger', 'nigga',
];

/*
  Trois racines retirees apres avoir fait tomber du francais courant :
  `retard` (mot de tous les jours), `fag` (attrapait « fagot », `faggot`
  reste), `rape` (tout fromage rape une fois les accents defaits). Les
  manquer est le prix ; le classificateur lit la phrase, pas les lettres.
*/

const ROOTS = new Set(SLUR_ROOTS.map((root) => squash(root)));

// Une racine breve ne se cherche pas dans un mot epele : trop de hasards.
const GLUED_MIN = 5;

// Une racine breve ne se cherche qu'a l'identique : « pd » n'a pas d'accord.
const ACCORD_MIN_ROOT = 4;
const ACCORD_MAX = 2;
const GLUED_ROOTS = [...ROOTS].filter((root) => root.length >= GLUED_MIN);

export type ModerationReason = 'slur';

export interface ModerationHit {
  reason: ModerationReason;
  // Le mot tel qu'il a ete reconnu, normalise. Jamais rendu au joueur.
  match: string;
}

/*
  Rend ce qui a ete reconnu, vide si rien.

  La comparaison porte sur le mot normalise et sur sa racine, pour attraper
  les accords et les conjugaisons, mais jamais sur une sous-chaine : c'est le
  meme piege que « dune » dans « dunes », et il produirait ici des refus
  absurdes sur des mots courants.
*/
export function screenText(text: string): ModerationHit[] {
  const hits: ModerationHit[] = [];

  for (const word of normalizeForModeration(text).split(' ')) {
    if (!word) continue;

    if (ROOTS.has(word)) {
      hits.push({ reason: 'slur', match: word });
      continue;
    }

    // Un accord ou une conjugaison courte : « connards », « encules ». Deux
    // lettres au plus, et rien pour les racines breves : a trois lettres pres,
    // « batard » attrapait « batardeau », qui est une piece de barrage.
    for (const root of ROOTS) {
      if (
        root.length >= ACCORD_MIN_ROOT &&
        word.length > root.length &&
        word.length <= root.length + ACCORD_MAX &&
        word.startsWith(root)
      ) {
        hits.push({ reason: 'slur', match: root });
        break;
      }
    }
  }

  if (hits.length === 0) {
    for (const spelled of spelledWords(normalizeForModeration(text).split(' '))) {
      const root = GLUED_ROOTS.find((candidate) => spelled.includes(candidate));
      if (root) {
        hits.push({ reason: 'slur', match: root });
        break;
      }
    }
  }

  return hits;
}

export function isClean(text: string): boolean {
  return screenText(text).length === 0;
}
