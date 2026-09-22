import type { LlmClient, LlmStreamEvent, LlmTrace } from '@odyssai/llm';
import {
  CharacterDraftSchema,
  type CharacterDraft,
  type UiLocale,
} from '@odyssai/schemas';
import {
  CHARACTER_PROMPT,
  CHARACTER_SHEET_MARKER,
  type ConversationTurn,
} from '../prompts/character/v1.js';
import { splitTail } from '../turn/split-tail.js';
import { CHARACTER_EXTRACT_PROMPT } from '../prompts/character-extract/v1.js';

export {
  CHARACTER_OPENING,
  CHARACTER_SHEET_MARKER,
} from '../prompts/character/v1.js';
export type { ConversationTurn };

export const CHARACTER_PROMPT_VERSION = CHARACTER_PROMPT.id;
export const CHARACTER_EXTRACT_PROMPT_VERSION = CHARACTER_EXTRACT_PROMPT.id;

export interface CharacterModelConfig {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  extraBody?: Record<string, unknown>;
}

export interface CharacterTurnRequest {
  llm: LlmClient;
  config: CharacterModelConfig;
  locale: UiLocale;
  history: ConversationTurn[];
  message: string;
  signal?: AbortSignal;
  trace?: LlmTrace;
}

export interface CharacterUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
}

export function buildCharacterMessages(
  locale: UiLocale,
  history: ConversationTurn[],
  message: string,
) {
  return CHARACTER_PROMPT.build(locale, history, message);
}

/*
  Un tour de conversation. Le texte est rendu au fil de l'eau, l'usage n'est
  connu qu'a la fin : l'appelant lit `usage()` une fois le flux epuise.

  Le marqueur de fiche est retire du texte par `splitTail`, donc ni diffuse ni
  enregistre : ce qui reste est la phrase adressee au joueur, et l'appelant lit
  `sheetRequested()` une fois le flux epuise pour savoir s'il faut la dresser.
*/
export function converseCharacter(request: CharacterTurnRequest): {
  chunks: AsyncIterable<string>;
  sheetRequested: () => boolean;
  usage: () => CharacterUsage;
} {
  const { llm, config, locale, history, message, signal, trace } =
    request;

  const split = splitTail(
    llm.streamChat({
      model: config.model,
      messages: buildCharacterMessages(locale, history, message),
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
      extraBody: config.extraBody,
      signal,
      trace,
    }),
    CHARACTER_SHEET_MARKER,
  );

  return {
    chunks: split.chunks,
    sheetRequested: split.seen,
    usage: () => split.usage(),
  };
}

function absorb(
  usage: CharacterUsage,
  event: Extract<LlmStreamEvent, { type: 'usage' }>,
): void {
  usage.model = event.model;
  usage.inputTokens = event.inputTokens;
  usage.outputTokens = event.outputTokens;
  usage.costUsd = event.costUsd;
}

export interface CharacterExtractRequest {
  llm: LlmClient;
  config: CharacterModelConfig;
  locale: UiLocale;
  history: ConversationTurn[];
  signal?: AbortSignal;
  trace?: LlmTrace;
}

/*
  `partial` n'est pas un echec : le modele a rendu du JSON, mais des champs
  n'ont pas tenu le schema. On garde ce qui tient et l'ecran demande le reste,
  plutot que de tout jeter pour un age fantaisiste.
*/
export type CharacterExtractResult =
  | { kind: 'ok'; character: CharacterDraft; missing: string[]; usage: CharacterUsage }
  | { kind: 'invalid_json'; usage: CharacterUsage };

const FIELDS = ['name', 'gender', 'age', 'personality', 'attributes'] as const;

function unwrap(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? raw).trim();
}

export async function extractCharacter(
  request: CharacterExtractRequest,
): Promise<CharacterExtractResult> {
  const { llm, config, locale, history, signal, trace } = request;

  let text = '';
  const usage: CharacterUsage = {};

  for await (const event of llm.streamChat({
    model: config.model,
    messages: CHARACTER_EXTRACT_PROMPT.build(locale, history),
    maxOutputTokens: config.maxOutputTokens,
    temperature: config.temperature,
    extraBody: config.extraBody,
    signal,
    trace,
  })) {
    if (event.type === 'text') text += event.text;
    if (event.type === 'usage') absorb(usage, event);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrap(text));
  } catch {
    return { kind: 'invalid_json', usage };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'invalid_json', usage };
  }

  // Champ par champ : un seul attribut hors bornes ne doit pas emporter le nom
  // et la personnalite avec lui.
  const source = parsed as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const field of FIELDS) {
    if (source[field] === undefined || source[field] === null) {
      missing.push(field);
      continue;
    }

    const single = CharacterDraftSchema.safeParse({ [field]: source[field] });
    if (single.success) kept[field] = source[field];
    else missing.push(field);
  }

  return {
    kind: 'ok',
    character: CharacterDraftSchema.parse(kept),
    missing,
    usage,
  };
}
