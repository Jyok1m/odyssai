import type { LlmClient, LlmTrace } from '@odyssai/llm';
import {
  WorldThemesSchema,
  findBorrowedNames,
  themesProse,
  type Inspiration,
  type UiLocale,
  type WorldThemes,
} from '@odyssai/schemas';
import { ABSTRACTION_PROMPT } from '../prompts/abstraction/v1.js';

export interface AbstractionModelConfig {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  extraBody?: Record<string, unknown>;
}

export interface AbstractionInput {
  inspiration: Inspiration;
  locale: UiLocale;
}

export interface AbstractionRequest {
  llm: LlmClient;
  config: AbstractionModelConfig;
  input: AbstractionInput;
  signal?: AbortSignal;
  trace?: LlmTrace;
}

/*
  `borrowed_names` n'est pas une panne : le modele a rendu des themes valides,
  mais il y a laisse un nom venu des oeuvres citees. La generation ne doit pas
  partir avec, et l'appelant relance.
*/
export type AbstractionRejection =
  | 'invalid_json'
  | 'invalid_shape'
  | 'borrowed_names';

export type AbstractionResult =
  | { kind: 'ok'; themes: WorldThemes; usage: AbstractionUsage }
  | {
      kind: 'rejected';
      reason: AbstractionRejection;
      details: string[];
      usage: AbstractionUsage;
    };

export interface AbstractionUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  cachedTokens?: number;
}

export const ABSTRACTION_PROMPT_VERSION = ABSTRACTION_PROMPT.id;

export function buildAbstractionMessages(input: AbstractionInput) {
  return ABSTRACTION_PROMPT.build(input.inspiration, input.locale);
}

/*
  Certains modeles enrobent leur JSON dans une balise de code malgre la
  consigne. Le refuser pour cela seul couterait une relance pour rien.
*/
function unwrap(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? raw).trim();
}

/*
  La passe d'abstraction. Elle convertit ce que le joueur a cite en themes, et
  c'est la seule etape a voir les titres.
*/
export async function abstractWorld(
  request: AbstractionRequest,
): Promise<AbstractionResult> {
  const { llm, config, input, signal, trace } = request;

  let text = '';
  const usage: AbstractionUsage = {};

  for await (const event of llm.streamChat({
    model: config.model,
    messages: buildAbstractionMessages(input),
    maxOutputTokens: config.maxOutputTokens,
    temperature: config.temperature,
    extraBody: config.extraBody,
    signal,
    trace,
  })) {
    if (event.type === 'text') text += event.text;
    if (event.type === 'usage') {
      usage.model = event.model;
      usage.inputTokens = event.inputTokens;
      usage.outputTokens = event.outputTokens;
      usage.costUsd = event.costUsd;
      usage.cachedTokens = event.cachedTokens;
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrap(text));
  } catch {
    return { kind: 'rejected', reason: 'invalid_json', details: [], usage };
  }

  // Deuxieme etage de la garde : le schema refuse les noms propres champ par
  // champ, quoi qu'ait compris le modele.
  const themes = WorldThemesSchema.safeParse(parsed);
  if (!themes.success) {
    return {
      kind: 'rejected',
      reason: 'invalid_shape',
      details: themes.error.issues.map(
        (issue) => `${issue.path.join('.') || '(racine)'} : ${issue.message}`,
      ),
      usage,
    };
  }

  // Troisieme etage : relecture contre les titres saisis. Un nom peut passer
  // les deux premiers en ouvrant une phrase.
  const works = input.inspiration.mode === 'works' ? input.inspiration.works : [];
  const borrowed = findBorrowedNames(themesProse(themes.data), works);
  if (borrowed.length > 0) {
    return { kind: 'rejected', reason: 'borrowed_names', details: borrowed, usage };
  }

  return { kind: 'ok', themes: themes.data, usage };
}
