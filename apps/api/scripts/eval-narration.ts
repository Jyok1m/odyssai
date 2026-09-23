/*
  Comparaison de modeles sur la passe d'abstraction.

    LLM_NARRATOR_CANDIDATES="a/modele,b/modele,c/modele" \
    pnpm --filter @odyssai/api eval:narration

  Le modele se choisit par evaluation, pas par reputation. Les evaluateurs
  sont en code, sans LLM juge : l'essentiel tient en une question binaire, le
  monde produit emprunte-t-il aux oeuvres citees.

  Hors de `make check`, et des appels reels : une execution vaut le nombre de
  cas multiplie par le nombre de candidats.
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'langsmith';
import { evaluate } from 'langsmith/evaluation';
import type { Example, Run } from 'langsmith/schemas';
import { createLlmClient } from '@odyssai/llm';
import {
  ABSTRACTION_PROMPT_VERSION,
  abstractWorld,
  type AbstractionResult,
} from '@odyssai/narrator';
import {
  findProperNouns,
  normalizeWorkTitle,
  themesProse,
  type Inspiration,
  type WorldThemes,
} from '@odyssai/schemas';
import { loadRootEnvFile } from '@odyssai/db';
import { GuideConfig } from '../dist/config/guide-config.js';
import { NarratorConfig } from '../dist/config/narrator-config.js';

/*
  Les deux langues, toujours : le meneur repond dans celle du joueur, et un
  modele qui abstrait proprement en francais peut emprunter en anglais. Un
  candidat ne se juge que sur son pire cote.

  Contrepartie a connaitre : le nombre d'appels double. Une execution vaut le
  nombre de cas multiplie par le nombre de candidats, multiplie par deux.
*/
const LOCALES = ['fr', 'en'] as const;
type EvalLocale = (typeof LOCALES)[number];

const datasetOf = (locale: EvalLocale) => `odyssai-abstraction-${locale}`;

interface EvalCase {
  id: string;
  mode: 'works' | 'own';
  works?: string[];
  ownDescription?: string;
  category: 'works' | 'own' | 'injection';
  // Noms qui ne doivent apparaitre nulle part dans les themes produits.
  banned: string[];
}

loadRootEnvFile(new URL('..', import.meta.url).pathname);

const narrator = new NarratorConfig();
if (!narrator.apiKey) {
  console.error(`cle absente pour le fournisseur ${narrator.provider}`);
  process.exit(1);
}

const candidates = narrator.candidates;
if (candidates.length === 0) {
  console.error(
    'LLM_NARRATOR_CANDIDATES est vide : renseigne les modeles a comparer, separes par des virgules',
  );
  process.exit(1);
}

// Le tracing du guide porte deja les coordonnees LangSmith : les dupliquer
// dans une seconde configuration ferait deux verites a tenir.
const tracing = new GuideConfig().tracing;

function casesOf(locale: EvalLocale): EvalCase[] {
  return readFileSync(
    join(
      new URL('..', import.meta.url).pathname,
      '..',
      '..',
      'packages',
      'narrator',
      'evals',
      `abstraction.${locale}.jsonl`,
    ),
    'utf8',
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as EvalCase);
}

const casesByLocale = new Map<EvalLocale, EvalCase[]>(
  LOCALES.map((locale) => [locale, casesOf(locale)]),
);

const client = new Client({
  apiUrl: tracing.endpoint,
  apiKey: tracing.apiKey,
  workspaceId: tracing.workspaceId,
});

for (const locale of LOCALES) {
  const name = datasetOf(locale);
  const dataset = await client.readDataset({ datasetName: name }).catch(async () =>
    client.createDataset(name, {
      description: `Passe d'abstraction d'OdyssAI (${locale}) : oeuvres citees vers themes.`,
    }),
  );

  // Les exemples portent leur `id` en metadonnee : une seconde execution les
  // met a jour au lieu d'en creer douze de plus.
  const existing = new Set<string>();
  for await (const example of client.listExamples({ datasetId: dataset.id })) {
    const key = (example.metadata as { caseId?: string } | undefined)?.caseId;
    if (key) existing.add(key);
  }

  const toCreate = casesByLocale.get(locale)!.filter((item) => !existing.has(item.id));
  if (toCreate.length === 0) continue;

  await client.createExamples(
    toCreate.map((item) => ({
      dataset_id: dataset.id,
      inputs: {
        mode: item.mode,
        works: item.works ?? [],
        ownDescription: item.ownDescription ?? '',
      },
      outputs: {},
      metadata: {
        caseId: item.id,
        category: item.category,
        banned: item.banned,
        works: item.works ?? [],
      },
    })),
  );
}

const llm = createLlmClient({
  provider: narrator.provider,
  apiKey: narrator.apiKey,
});

interface Inputs {
  mode: 'works' | 'own';
  works: string[];
  ownDescription: string;
}

function toInspiration(inputs: Inputs): Inspiration {
  return inputs.mode === 'works'
    ? { mode: 'works', works: inputs.works }
    : { mode: 'own', ownDescription: inputs.ownDescription };
}

interface Output {
  kind: AbstractionResult['kind'];
  reason?: string;
  details: string[];
  prose: string;
  themes: WorldThemes | null;
  costUsd?: number;
}

function target(model: string, locale: EvalLocale) {
  return async function run(inputs: Inputs): Promise<Output> {
    const result = await abstractWorld({
      llm,
      config: {
        model,
        temperature: narrator.modelFor('abstraction').temperature,
        maxOutputTokens: narrator.modelFor('abstraction').maxOutputTokens,
        extraBody: narrator.extraBody,
      },
      input: { inspiration: toInspiration(inputs), locale },
      trace: {
        name: 'abstraction',
        metadata: { prompt_version: ABSTRACTION_PROMPT_VERSION, model, locale },
      },
    });

    if (result.kind === 'ok') {
      return {
        kind: 'ok',
        details: [],
        prose: themesProse(result.themes),
        themes: result.themes,
        costUsd: result.usage.costUsd,
      };
    }

    return {
      kind: 'rejected',
      reason: result.reason,
      details: result.details,
      prose: '',
      themes: null,
      costUsd: result.usage.costUsd,
    };
  };
}

function meta(example?: Example) {
  const raw = (example?.metadata ?? {}) as {
    category?: EvalCase['category'];
    banned?: string[];
    works?: string[];
  };
  return {
    category: raw.category ?? 'works',
    banned: raw.banned ?? [],
    works: raw.works ?? [],
  };
}

function output(run: Run): Output {
  const raw = (run.outputs ?? {}) as Partial<Output>;
  return {
    kind: raw.kind ?? 'rejected',
    reason: raw.reason,
    details: raw.details ?? [],
    prose: raw.prose ?? '',
    themes: raw.themes ?? null,
    costUsd: raw.costUsd,
  };
}

const evaluators = [
  // Le modele rend-il des themes exploitables du premier coup.
  function accepted(run: Run) {
    const value = output(run);
    return {
      key: 'accepted',
      score: value.kind === 'ok' ? 1 : 0,
      comment: value.reason
        ? `${value.reason} : ${value.details.slice(0, 3).join(' | ')}`
        : undefined,
    };
  },

  /*
    Le controle le plus severe, et le seul ecrit a la main cas par cas : aucun
    nom de l'oeuvre citee ne doit survivre a l'abstraction.

    Une sortie rejetee vaut zero et non un. Sa prose est vide, donc elle
    passerait tous les controles de surete sans rien avoir produit, et un
    modele incapable de repondre s'afficherait comme le plus sur de tous.
  */
  function no_banned_name(run: Run, example?: Example) {
    const value = output(run);
    if (value.kind !== 'ok') return { key: 'no_banned_name', score: 0 };

    const { banned } = meta(example);
    if (banned.length === 0) return { key: 'no_banned_name', score: 1 };

    /*
      Sur des mots entiers et non en sous-chaine : « San » se retrouve dans
      « sans » et « paysan », et faisait echouer des sorties propres. Meme
      piege que dans findBorrowedNames.
    */
    const prose = ` ${normalizeWorkTitle(value.prose)} `;
    const leaked = banned.filter((name) =>
      prose.includes(` ${normalizeWorkTitle(name)} `),
    );

    return {
      key: 'no_banned_name',
      score: leaked.length === 0 ? 1 : 0,
      comment: leaked.length > 0 ? `fuite : ${leaked.join(', ')}` : undefined,
    };
  },

  function no_proper_noun(run: Run) {
    const value = output(run);
    if (value.kind !== 'ok') return { key: 'no_proper_noun', score: 0 };

    const found = findProperNouns(value.prose);
    return {
      key: 'no_proper_noun',
      score: found.length === 0 ? 1 : 0,
      comment: found.length > 0 ? found.slice(0, 5).join(', ') : undefined,
    };
  },

  function no_em_dash(run: Run) {
    const value = output(run);
    if (value.kind !== 'ok') return { key: 'no_em_dash', score: 0 };
    return { key: 'no_em_dash', score: value.prose.includes('—') ? 0 : 1 };
  },

  // Un monde se dit, il ne s'esquisse pas : trop court, il ne nourrit rien.
  function rich_enough(run: Run) {
    const themes = output(run).themes;
    if (!themes) return { key: 'rich_enough', score: 0 };

    const words = output(run).prose.trim().split(/\s+/).filter(Boolean).length;
    return { key: 'rich_enough', score: words >= 80 ? 1 : 0, comment: `${words} mots` };
  },
];

interface Score {
  total: number;
  count: number;
}

const cost = new Map<string, number>();

const summary = new Map<string, Map<string, Score>>();
const failures: string[] = [];
let spent = 0;

/*
  Une ligne par modele et par langue : c'est l'ecart entre les deux qui se
  regarde, pas la moyenne des deux. Un modele qui abstrait proprement en
  francais et emprunte en anglais ne vaut pas un modele regulier.
*/
for (const model of candidates) {
  for (const locale of LOCALES) {
    const row = `${model} (${locale})`;
    console.log(`\n--- ${row}`);

    const results = await evaluate(target(model, locale), {
      data: datasetOf(locale),
      evaluators,
      client,
      experimentPrefix: `${ABSTRACTION_PROMPT_VERSION} ${locale} ${model}`,
      // Un seul a la fois : comparer des modeles sous des limites de debit
      // differentes mesurerait le fournisseur, pas le modele.
      maxConcurrency: 2,
    });

    const perKey = new Map<string, Score>();
    for (const result of results.results) {
      const caseId =
        ((result.example?.metadata ?? {}) as { caseId?: string }).caseId ?? '?';

      for (const evaluation of result.evaluationResults.results) {
        const value = typeof evaluation.score === 'number' ? evaluation.score : 0;
        const score = perKey.get(evaluation.key) ?? { total: 0, count: 0 };
        score.total += value;
        score.count += 1;
        perKey.set(evaluation.key, score);

        if (value < 1) {
          failures.push(
            `${row} · ${caseId} · ${evaluation.key}${evaluation.comment ? ` · ${evaluation.comment}` : ''}`,
          );
        }
      }

      const paid = (result.run.outputs as { costUsd?: number } | undefined)?.costUsd;
      if (typeof paid === 'number') {
        spent += paid;
        cost.set(row, (cost.get(row) ?? 0) + paid);
      }
    }

    summary.set(row, perKey);
  }
}


const keys = evaluators.map((evaluator) => evaluator.name);
console.log(
  `\n${'modele'.padEnd(40)}${keys.map((k) => k.padEnd(18)).join('')}${'cout'.padEnd(12)}`,
);

for (const [line, perKey] of summary) {
  const cells = keys.map((key) => {
    const score = perKey.get(key);
    const value = score && score.count > 0 ? score.total / score.count : 0;
    return `${(value * 100).toFixed(0)} %`.padEnd(18);
  });
  const paid = cost.get(line) ?? 0;
  console.log(
    `${line.padEnd(40)}${cells.join('')}${(paid > 0 ? `${paid.toFixed(5)} USD` : 'n/c').padEnd(12)}`,
  );
}

if (failures.length > 0) {
  console.log(`\nEchecs, cas par cas :`);
  for (const line of failures) console.log(`  ${line}`);
}

console.log(
  `\n${casesByLocale.get('fr')!.length} cas par modele et par langue, ${LOCALES.length} langues. Cout total rapporte : ${spent > 0 ? `${spent.toFixed(4)} USD` : 'non rapporte par le fournisseur'}.`,
);
console.log(
  'Reporte le gagnant dans packages/llm/src/models.ts, role abstraction, et garde LLM_NARRATOR_CANDIDATES pour la prochaine comparaison.',
);
