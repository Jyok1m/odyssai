import type { LlmClient, LlmTrace } from '@odyssai/llm';
import type { UiLocale } from '@odyssai/schemas';
import { GUIDE_CORPUS, GUIDE_CORPUS_VERSION } from '../generated/guide-corpus.js';
import { GUIDE_PROMPT, type PromptMessage } from '../prompts/guide/v2.js';
import { splitOffTopic, type OffTopicSplit } from './off-topic.js';

export interface GuideModelConfig {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  extraBody?: Record<string, unknown>;
}

export interface GuideInput {
  question: string;
  locale: UiLocale;
  /**
   * Ce que le corpus ne peut pas porter : les paliers et leurs montants, qui
   * vivent en base et chez Stripe. Le corpus est genere depuis les messages du
   * site, ou aucun prix ne figure, et c'est voulu : les recopier ferait deux
   * verites. Releve a chaque question, donc toujours juste.
   */
  live?: string;
}

export interface GuideRequest {
  llm: LlmClient;
  config: GuideModelConfig;
  input: GuideInput;
  signal?: AbortSignal;
  trace?: LlmTrace;
  onTraced?: (traced: boolean) => void;
}

export type GuideResult = OffTopicSplit & {
  promptVersion: string;
  corpusVersion: string;
};

export const GUIDE_PROMPT_VERSION = GUIDE_PROMPT.id;
export { GUIDE_CORPUS, GUIDE_CORPUS_VERSION };

/**
 * Messages envoyes au modele. Exportee a part pour que l'api puisse mesurer le
 * prompt complet avant d'appeler, et reserver le budget en consequence.
 */
export function buildGuideMessages(input: GuideInput): PromptMessage[] {
  return GUIDE_PROMPT.build(
    input.locale,
    GUIDE_CORPUS[input.locale],
    input.question,
    input.live,
  );
}

/**
 * Un tour de guide. Le client LLM est injecte : le paquet ne lit jamais
 * l'environnement et ne construit jamais de client lui-meme.
 */
export async function guide(request: GuideRequest): Promise<GuideResult> {
  const { llm, config, input, signal, trace, onTraced } = request;

  // Un controleur interne, pour que la detection du hors-sujet puisse couper
  // l'appel amont sans priver l'appelant de son propre abandon.
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const stream = llm.streamChat({
    model: config.model,
    messages: buildGuideMessages(input),
    maxOutputTokens: config.maxOutputTokens,
    temperature: config.temperature,
    extraBody: config.extraBody,
    signal: controller.signal,
    trace,
    onTraced,
  });

  const split = await splitOffTopic(stream, controller);

  return {
    ...split,
    promptVersion: GUIDE_PROMPT.id,
    corpusVersion: GUIDE_CORPUS_VERSION,
  };
}
