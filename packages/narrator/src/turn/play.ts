import type { LlmClient, LlmTrace } from '@odyssai/llm';
import {
  CANON_FACTS_PER_TURN_MAX,
  TurnDeltaSchema,
  type CanonFact,
  type TurnDelta,
  type UiLocale,
} from '@odyssai/schemas';
import { TURN_PROMPT, type TurnContext } from '../prompts/turn/v1.js';
import { splitTail, type TailUsage } from './split-tail.js';

export { CANON_MARKER } from './split-tail.js';
export type { TurnContext };

export const TURN_PROMPT_VERSION = TURN_PROMPT.id;

export interface TurnModelConfig {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  extraBody?: Record<string, unknown>;
}

export interface PlayTurnRequest {
  llm: LlmClient;
  config: TurnModelConfig;
  locale: UiLocale;
  context: TurnContext;
  message: string;
  signal?: AbortSignal;
  trace?: LlmTrace;
}

export interface PlayedTurn {
  /** Le recit, au fil de l'eau. */
  chunks: AsyncIterable<string>;
  /**
   * Ce que le modele a rendu en queue. Definitif une fois `chunks` epuise.
   * Un bloc absent ou illisible rend le tour par defaut : le recit tient
   * quand meme, seul le canon ne grandit pas.
   */
  delta: () => TurnDelta;
  usage: () => TailUsage;
}

export function buildTurnMessages(
  locale: UiLocale,
  context: TurnContext,
  message: string,
) {
  return TURN_PROMPT.build(locale, context, message);
}

/** Un bloc absent vaut une action sans de et sans fait invente. */
const DEFAULT_DELTA: TurnDelta = { kind: 'action', usedDie: false, facts: [] };

function unwrap(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? raw).trim();
}

/**
 * Lit le bloc de queue sans jamais jeter.
 *
 * Le recit est deja parti au joueur quand cette fonction s'execute : une
 * exception ici lui retirerait un tour qu'il a lu. On degrade donc, champ par
 * champ, comme le fait l'extraction de fiche de personnage.
 */
export function readDelta(tail: string): TurnDelta {
  if (!tail.trim()) return DEFAULT_DELTA;

  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrap(tail));
  } catch {
    return DEFAULT_DELTA;
  }

  const whole = TurnDeltaSchema.safeParse(parsed);
  if (whole.success) return whole.data;

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return DEFAULT_DELTA;
  }

  // Un fait mal forme ne doit pas emporter les autres, ni le type du tour.
  const source = parsed as Record<string, unknown>;
  const facts: CanonFact[] = [];

  if (Array.isArray(source.facts)) {
    for (const candidate of source.facts) {
      const single = TurnDeltaSchema.safeParse({
        kind: 'question',
        usedDie: false,
        facts: [candidate],
      });
      if (single.success && single.data.facts[0]) facts.push(single.data.facts[0]);
    }
  }

  return {
    kind: source.kind === 'question' ? 'question' : 'action',
    usedDie: source.usedDie === true,
    facts: facts.slice(0, CANON_FACTS_PER_TURN_MAX),
  };
}

/**
 * Un tour de jeu.
 *
 * Le flux n'est jamais avorte, meme si le joueur s'en va : le bloc de queue
 * doit arriver pour que le canon s'ecrive. C'est a l'appelant d'arreter la
 * diffusion sans arreter la generation.
 */
export function playTurn(request: PlayTurnRequest): PlayedTurn {
  const { llm, config, locale, context, message, signal, trace } = request;

  const split = splitTail(
    llm.streamChat({
      model: config.model,
      messages: buildTurnMessages(locale, context, message),
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
      extraBody: config.extraBody,
      signal,
      trace,
    }),
  );

  return {
    chunks: split.chunks,
    delta: () => readDelta(split.tail()),
    usage: split.usage,
  };
}
