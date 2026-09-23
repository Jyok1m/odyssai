import type { LlmClient, LlmTrace } from '@odyssai/llm';
import { findBorrowedNames } from '@odyssai/schemas';
import { DIALOGUE_PROMPT, type DialogueContext } from '../prompts/dialogue/v1.js';
import type { JsonModelConfig, JsonUsage } from '../world/json.js';

export const DIALOGUE_PROMPT_VERSION = DIALOGUE_PROMPT.id;

// Au dela, ce n'est plus une replique : on coupe a la fin d'une phrase.
const LINE_MAX = 400;

export interface SpeakLineRequest {
  llm: LlmClient;
  config: JsonModelConfig;
  context: DialogueContext;
  message: string;
  // Les oeuvres citees, pour la garde sur les emprunts. Jamais dans le prompt.
  works: string[];
  signal?: AbortSignal;
  trace?: LlmTrace;
}

export type SpeakLineResult =
  | { kind: 'ok'; line: string; usage: JsonUsage }
  | { kind: 'rejected'; reason: 'empty' | 'borrowed'; usage: JsonUsage };

/*
  Nettoie ce qu'un modele de jeu de role rend malgre la consigne : le nom en
  tete, les guillemets, les didascalies entre asterisques, les retours a la
  ligne. Ce qui reste est la replique, ou rien.
*/
export function cleanLine(raw: string, speaker: string): string {
  let text = raw
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  /*
    Il raconte parfois autour de la replique malgre la consigne : ce qui est
    entre guillemets est la replique, le reste est du recit qui n'est pas le
    sien a faire. Un guillemet ouvert sans fermeture prend tout ce qui suit.
  */
  const opened = text.search(/[«"“]/);
  if (opened >= 0) {
    const inside = text.slice(opened + 1);
    const closed = inside.search(/[»"”]/);
    text = (closed >= 0 ? inside.slice(0, closed) : inside).trim();
  }

  const prefix = new RegExp(`^${speaker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i');
  text = text.replace(prefix, '').trim();
  text = text.replace(/^["«“'\s]+|["»”'\s]+$/g, '').trim();

  if (text.length > LINE_MAX) {
    const cut = text.slice(0, LINE_MAX);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    text = (end > 0 ? cut.slice(0, end + 1) : cut).trim();
  }

  return text;
}

/*
  La replique d'un personnage, par le modele de jeu de role. Un seul appel :
  une replique absente ne coute rien au tour, le meneur fait parler le
  personnage lui-meme comme avant.
*/
export async function speakLine(request: SpeakLineRequest): Promise<SpeakLineResult> {
  const { llm, config, context, message, signal, trace } = request;

  let text = '';
  const usage: JsonUsage = {};

  for await (const event of llm.streamChat({
    model: config.model,
    messages: DIALOGUE_PROMPT.build(context, message),
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

  const line = cleanLine(text, context.npc.name);
  if (line.length === 0) return { kind: 'rejected', reason: 'empty', usage };
  if (findBorrowedNames(line, request.works).length > 0) {
    return { kind: 'rejected', reason: 'borrowed', usage };
  }

  return { kind: 'ok', line, usage };
}
