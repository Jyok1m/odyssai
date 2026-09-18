import type { LlmClient } from '@odyssai/llm';
import { ModerationVerdictSchema, type ModerationVerdict, type UiLocale } from '@odyssai/schemas';
import type { TailUsage } from './split-tail.js';
import { MODERATION_PROMPT } from '../prompts/moderation/v1.js';

export const MODERATION_PROMPT_VERSION = MODERATION_PROMPT.id;

export interface ModerateRequest {
  llm: LlmClient;
  config: {
    model: string;
    temperature: number;
    maxOutputTokens: number;
    /**
     * Meme role que pour la narration : couper le raisonnement, refuser la
     * collecte. Un verdict d'une ligne n'a rien a deliberer, et le texte qui
     * arrive ici est precisement celui qu'on ne veut pas voir servir de
     * donnee d'entrainement.
     */
    extraBody?: Record<string, unknown>;
  };
  locale: UiLocale;
  text: string;
  signal?: AbortSignal;
}

/**
 * Le verdict du classificateur.
 *
 * Une sortie illisible vaut acceptation, et c'est deliberé : un modele qui ne
 * repond pas ne doit pas empecher de jouer. La couche lexicale, elle, a deja
 * tourne et n'a rien laisse passer d'evident ; ce qui arrive ici est du
 * jugement, pas de l'evidence.
 */
/** Ce qu'on retient quand le classificateur n'a rien dit d'exploitable. */
const OPEN: ModerationVerdict = { allow: true, reason: null, language: null };

export interface ModerationResult {
  verdict: ModerationVerdict;
  /** Un appel par message joueur : l'ignorer creait un angle mort complet. */
  usage: TailUsage;
}

export async function moderate(
  request: ModerateRequest,
): Promise<ModerationResult> {
  let text = '';
  const usage: TailUsage = {};

  for await (const event of request.llm.streamChat({
    model: request.config.model,
    messages: MODERATION_PROMPT.build(request.locale, request.text),
    maxOutputTokens: request.config.maxOutputTokens,
    temperature: request.config.temperature,
    extraBody: request.config.extraBody,
    signal: request.signal,
  })) {
    if (event.type === 'text') text += event.text;
    if (event.type === 'usage') {
      usage.model = event.model;
      usage.inputTokens = event.inputTokens;
      usage.outputTokens = event.outputTokens;
      usage.reasoningTokens = event.reasoningTokens;
      usage.costUsd = event.costUsd;
    }
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);

  try {
    const parsed = ModerationVerdictSchema.safeParse(
      JSON.parse((fenced?.[1] ?? text).trim()),
    );
    return { verdict: parsed.success ? parsed.data : OPEN, usage };
  } catch {
    return { verdict: OPEN, usage };
  }
}
