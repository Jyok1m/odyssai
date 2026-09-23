import { z } from 'zod';
import type { LlmClient, LlmTrace } from '@odyssai/llm';
import { findBorrowedNames } from '@odyssai/schemas';
import { MARK_PROMPT, type MarkContext } from '../prompts/mark/v1.js';
import { callJson, type JsonModelConfig, type JsonUsage } from './json.js';

export const MARK_PROMPT_VERSION = MARK_PROMPT.id;

/*
  Le modele n'ecrit que le texte : le genre a ete decide par le code, et le
  monde comme la date viennent d'ailleurs. Une sortie qui porterait autre
  chose serait ignoree de toute facon.
*/
const MarkTextSchema = z.object({
  text: z.string().trim().min(3).max(140),
});

export interface DescribeMarkRequest {
  llm: LlmClient;
  config: JsonModelConfig;
  locale: 'fr' | 'en';
  context: MarkContext;
  // Les oeuvres citees, pour la garde sur les emprunts. Jamais dans le prompt.
  works: string[];
  signal?: AbortSignal;
  trace?: LlmTrace;
}

export type DescribeMarkResult =
  | { kind: 'ok'; text: string; usage: JsonUsage }
  | {
      kind: 'rejected';
      reason: 'invalid_json' | 'invalid_shape' | 'borrowed';
      usage: JsonUsage;
    };

/*
  La ligne que le personnage garde de ce tour.

  Rejoue une fois une sortie illisible, comme un fragment de lore ; au dela,
  le personnage repart sans marque et le tour n'en souffre pas. Une marque
  absente est une occasion manquee, jamais une partie cassee.
*/
export async function describeMark(
  request: DescribeMarkRequest,
): Promise<DescribeMarkResult> {
  const messages = MARK_PROMPT.build(request.locale, request.context);
  let last: DescribeMarkResult | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await callJson({
      llm: request.llm,
      config: request.config,
      messages,
      signal: request.signal,
      trace: request.trace,
    });

    if (result.kind !== 'ok') {
      last = { kind: 'rejected', reason: 'invalid_json', usage: result.usage };
      continue;
    }

    const parsed = MarkTextSchema.safeParse(result.value);
    if (!parsed.success) {
      last = { kind: 'rejected', reason: 'invalid_shape', usage: result.usage };
      continue;
    }

    // Une marque voyage d'un monde a l'autre : un nom emprunte y survivrait
    // plus longtemps que partout ailleurs.
    if (findBorrowedNames(parsed.data.text, request.works).length > 0) {
      return { kind: 'rejected', reason: 'borrowed', usage: result.usage };
    }

    return { kind: 'ok', text: parsed.data.text, usage: result.usage };
  }

  return last!;
}
