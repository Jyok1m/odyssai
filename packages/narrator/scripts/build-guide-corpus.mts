/**
 * Genere le corpus du guide depuis les messages next-intl du site vitrine.
 *
 * Le fichier produit est commite : c'est plus simple et plus reproductible que
 * de faire dependre le cache turbo de fichiers d'un autre paquet. `corpus:check`
 * regenere en memoire et echoue si le fichier commite a derive.
 *
 *   node scripts/build-guide-corpus.mts            ecrit le fichier
 *   node scripts/build-guide-corpus.mts --check    verifie sans ecrire
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MESSAGES = join(HERE, '..', '..', '..', 'apps', 'web', 'messages');
const OUTPUT = join(HERE, '..', 'src', 'generated', 'guide-corpus.ts');

const LOCALES = ['fr', 'en'] as const;
type Locale = (typeof LOCALES)[number];

/** Seules les pages de contenu. Le reste du site est de la navigation. */
const PAGES = [
  'Concept',
  'Universes',
  'Multiverse',
  'Lore',
  'Glossary',
] as const;

const PAGE_TITLES: Record<Locale, Record<(typeof PAGES)[number], string>> = {
  fr: {
    Concept: 'Concept',
    Universes: 'Univers',
    Multiverse: 'Multivers',
    Lore: 'Lore General',
    Glossary: 'Glossaire',
  },
  en: {
    Concept: 'Concept',
    Universes: 'Universes',
    Multiverse: 'Multiverse',
    Lore: 'General Lore',
    Glossary: 'Glossary',
  },
};

/** SEO, navigation et appels a l'action n'apprennent rien sur le jeu. */
const DROPPED_KEYS = new Set(['metaTitle', 'metaDescription', 'glossaryCta']);

interface Section {
  title?: string;
  body?: unknown;
}

interface Entry {
  term?: string;
  meaning?: string;
}

interface Page {
  lead?: string;
  intro?: unknown;
  sections?: Section[];
  entries?: Entry[];
}

/**
 * Retire les balises de texte riche et les placeholders ICU. Aucun des deux
 * n'apparait dans ces namespaces aujourd'hui : la passe reste defensive, pour
 * qu'un ajout futur n'injecte pas de balisage dans le prompt.
 */
function clean(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/\{[^{}]*\}/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function paragraphs(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = clean(value);
    return text ? [text] : [];
  }
  if (Array.isArray(value)) return value.flatMap(paragraphs);
  return [];
}

function renderPage(locale: Locale, name: (typeof PAGES)[number], page: Page): string {
  const lines: string[] = [`## ${PAGE_TITLES[locale][name]}`];

  lines.push(...paragraphs(page.lead));
  lines.push(...paragraphs(page.intro));

  for (const section of page.sections ?? []) {
    const title = section.title ? clean(section.title) : '';
    if (title) lines.push(`### ${title}`);
    lines.push(...paragraphs(section.body));
  }

  for (const entry of page.entries ?? []) {
    const term = entry.term ? clean(entry.term) : '';
    const meaning = entry.meaning ? clean(entry.meaning) : '';
    if (term && meaning) lines.push(`${term} : ${meaning}`);
  }

  return lines.join('\n');
}

function buildCorpus(locale: Locale): string {
  const messages = JSON.parse(
    readFileSync(join(MESSAGES, `${locale}.json`), 'utf8'),
  ) as Record<string, Page>;

  return PAGES.map((name) => {
    const page = messages[name];
    if (!page) throw new Error(`namespace ${name} absent de ${locale}.json`);

    // Le filtrage par cle se fait ici, a la lecture : renderPage ne touche
    // qu'a ce qui reste.
    const kept = Object.fromEntries(
      Object.entries(page).filter(([key]) => !DROPPED_KEYS.has(key)),
    ) as Page;

    return renderPage(locale, name, kept);
  }).join('\n\n');
}

function generate(): { corpus: Record<Locale, string>; version: string; file: string } {
  const corpus = Object.fromEntries(
    LOCALES.map((locale) => [locale, buildCorpus(locale)]),
  ) as Record<Locale, string>;

  const version = createHash('sha256')
    .update(LOCALES.map((locale) => corpus[locale]).join('\n'))
    .digest('hex')
    .slice(0, 12);

  const file = `/* Genere par scripts/build-guide-corpus.mts. Ne pas editer a la main. */
/* Regenerer par \`pnpm --filter @odyssai/narrator corpus:build\`. */
import type { UiLocale } from '@odyssai/schemas';

export const GUIDE_CORPUS: Record<UiLocale, string> = ${JSON.stringify(corpus, null, 2)};

export const GUIDE_CORPUS_VERSION = '${version}';
`;

  return { corpus, version, file };
}

const { corpus, version, file } = generate();

if (process.argv.includes('--check')) {
  const current = readFileSync(OUTPUT, 'utf8');
  if (current !== file) {
    console.error(
      'guide-corpus.ts a derive des messages next-intl.\n' +
        'Relance `pnpm --filter @odyssai/narrator corpus:build` et commite le resultat.',
    );
    process.exit(1);
  }
  console.log(`corpus a jour, version ${version}`);
} else {
  writeFileSync(OUTPUT, file);
  for (const locale of LOCALES) {
    const chars = corpus[locale].length;
    console.log(
      `${locale} : ${chars} caracteres, ~${Math.round(chars / 4)} tokens estimes`,
    );
  }
  console.log(`version ${version}`);
}
