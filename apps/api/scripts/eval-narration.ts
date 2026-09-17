/**
 * Comparaison de modeles sur la passe d'abstraction.
 *
 *   LLM_NARRATOR_CANDIDATES="a/modele,b/modele,c/modele" \
 *   pnpm --filter @odyssai/api eval:narration
 *
 * Le modele de narration se choisit par evaluation, pas par reputation. Les
 * evaluateurs sont en code, sans LLM juge : ce qu'on mesure ici est verifiable
 * sans avis, et l'essentiel tient en une question binaire, le monde produit
 * emprunte-t-il quelque chose aux oeuvres citees.
 *
 * Ce script n'entre pas dans `make check` et consomme des appels reels : une
 * execution vaut le nombre de cas multiplie par le nombre de candidats.
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
  themesProse,
  type Inspiration,
  type WorldThemes,
} from '@odyssai/schemas';
import { loadRootEnvFile } from '@odyssai/db';
import { GuideConfig } from '../dist/config/guide-config.js';
import { NarratorConfig } from '../dist/config/narrator-config.js';

const DATASET = 'odyssai-abstraction-fr';

interface EvalCase {
  id: string;
  mode: 'works' | 'own';
  works?: string[];
  ownDescription?: string;
  category: 'works' | 'own' | 'injection';
  /** Noms qui ne doivent apparaitre nulle part dans les themes produits. */
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

const cases: EvalCase[] = readFileSync(
  join(
    new URL('..', import.meta.url).pathname,
    '..',
    '..',
    'packages',
    'narrator',
    'evals',
    'abstraction.fr.jsonl',
  ),
  'utf8',
)
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as EvalCase);

const client = new Client({
  apiUrl: tracing.endpoint,
  apiKey: tracing.apiKey,
  workspaceId: tracing.workspaceId,
});

const dataset = await client
  .readDataset({ datasetName: DATASET })
  .catch(async () =>
    client.createDataset(DATASET, {
      description: "Passe d'abstraction d'OdyssAI : oeuvres citees vers themes.",
    }),
  );

// Les exemples portent leur `id` en metadonnee : une seconde execution les met
// a jour au lieu d'en creer douze de plus.
const existing = new Set<string>();
for await (const example of client.listExamples({ datasetId: dataset.id })) {
  const key = (example.metadata as { caseId?: string } | undefined)?.caseId;
  if (key) existing.add(key);
}

const toCreate = cases.filter((item) => !existing.has(item.id));
if (toCreate.length > 0) {
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

function target(model: string) {
  return async function run(inputs: Inputs): Promise<Output> {
    const result = await abstractWorld({
      llm,
      config: {
        model,
        temperature: narrator.model.temperature,
        maxOutputTokens: narrator.model.maxOutputTokens,
        extraBody: narrator.extraBody,
      },
      input: { inspiration: toInspiration(inputs), locale: 'fr' },
      trace: {
        name: 'abstraction',
        metadata: { prompt_version: ABSTRACTION_PROMPT_VERSION, model },
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
  /** Le modele rend-il des themes exploitables du premier coup. */
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

  /**
   * Le controle le plus severe, et le seul ecrit a la main cas par cas : aucun
   * nom de l'oeuvre citee ne doit survivre a l'abstraction.
   */
  function no_banned_name(run: Run, example?: Example) {
    const { banned } = meta(example);
    if (banned.length === 0) return { key: 'no_banned_name', score: 1 };

    const prose = output(run).prose.toLowerCase();
    const leaked = banned.filter((name) => prose.includes(name.toLowerCase()));

    return {
      key: 'no_banned_name',
      score: leaked.length === 0 ? 1 : 0,
      comment: leaked.length > 0 ? `fuite : ${leaked.join(', ')}` : undefined,
    };
  },

  function no_proper_noun(run: Run) {
    const found = findProperNouns(output(run).prose);
    return {
      key: 'no_proper_noun',
      score: found.length === 0 ? 1 : 0,
      comment: found.length > 0 ? found.slice(0, 5).join(', ') : undefined,
    };
  },

  function no_em_dash(run: Run) {
    return { key: 'no_em_dash', score: output(run).prose.includes('—') ? 0 : 1 };
  },

  /** Un monde se dit, il ne s'esquisse pas : trop court, il ne nourrit rien. */
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

const summary = new Map<string, Map<string, Score>>();
let spent = 0;

for (const model of candidates) {
  console.log(`\n--- ${model}`);

  const results = await evaluate(target(model), {
    data: DATASET,
    evaluators,
    client,
    experimentPrefix: `abstraction/v1 ${model}`,
    // Un seul a la fois : comparer des modeles sous des limites de debit
    // differentes mesurerait le fournisseur, pas le modele.
    maxConcurrency: 2,
  });

  const perKey = new Map<string, Score>();
  for (const row of results.results) {
    for (const evaluation of row.evaluationResults.results) {
      const score = perKey.get(evaluation.key) ?? { total: 0, count: 0 };
      score.total += typeof evaluation.score === 'number' ? evaluation.score : 0;
      score.count += 1;
      perKey.set(evaluation.key, score);
    }

    const cost = (row.run.outputs as { costUsd?: number } | undefined)?.costUsd;
    if (typeof cost === 'number') spent += cost;
  }

  summary.set(model, perKey);
}

await llm.flushTraces();

const keys = evaluators.map((evaluator) => evaluator.name);
console.log(`\n${'modele'.padEnd(34)}${keys.map((k) => k.padEnd(18)).join('')}`);

for (const [model, perKey] of summary) {
  const cells = keys.map((key) => {
    const score = perKey.get(key);
    const value = score && score.count > 0 ? score.total / score.count : 0;
    return `${(value * 100).toFixed(0)} %`.padEnd(18);
  });
  console.log(`${model.padEnd(34)}${cells.join('')}`);
}

console.log(
  `\n${cases.length} cas par modele. Cout total rapporte : ${spent > 0 ? `${spent.toFixed(4)} USD` : 'non rapporte par le fournisseur'}.`,
);
console.log(
  'Reporte le gagnant dans LLM_NARRATOR_MODEL, et garde LLM_NARRATOR_CANDIDATES pour la prochaine comparaison.',
);
