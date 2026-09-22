import type { LlmClient, LlmTrace } from '@odyssai/llm';
import {
  LoreFragmentSchema,
  findBorrowedNames,
  type LoreFragment,
} from '@odyssai/schemas';
import { LORE_PROMPT, type LoreContext } from '../prompts/lore/v1.js';
import { callJson, type JsonModelConfig, type JsonUsage } from './json.js';

export const LORE_PROMPT_VERSION = LORE_PROMPT.id;

export interface DescribeEntityRequest {
  llm: LlmClient;
  config: JsonModelConfig;
  locale: 'fr' | 'en';
  context: LoreContext;
  // Les oeuvres citees, pour la garde sur les emprunts. Jamais dans le prompt.
  works: string[];
  signal?: AbortSignal;
  trace?: LlmTrace;
}

export type DescribeEntityResult =
  | { kind: 'ok'; fragment: LoreFragment; usage: JsonUsage }
  | { kind: 'rejected'; reason: 'invalid_json' | 'invalid_shape' | 'borrowed'; usage: JsonUsage };

/*
  Un fragment de lore pour une entite nouvelle. Rejoue une fois une sortie
  illisible, comme un noeud du graphe ; au dela, l'entite reste sans histoire
  et le tour n'en souffre pas. La garde sur les emprunts relit la prose comme
  celle du lore : un nom refuse a la generation ne rentre pas par la.
*/
export async function describeEntity(
  request: DescribeEntityRequest,
): Promise<DescribeEntityResult> {
  const messages = LORE_PROMPT.build(request.locale, request.context);
  let last: DescribeEntityResult | null = null;

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

    const parsed = LoreFragmentSchema.safeParse(result.value);
    if (!parsed.success) {
      last = { kind: 'rejected', reason: 'invalid_shape', usage: result.usage };
      continue;
    }

    const borrowed = findBorrowedNames(
      `${parsed.data.known} ${parsed.data.hidden}`,
      request.works,
    );
    if (borrowed.length > 0) {
      return { kind: 'rejected', reason: 'borrowed', usage: result.usage };
    }

    return { kind: 'ok', fragment: parsed.data, usage: result.usage };
  }

  return last!;
}
