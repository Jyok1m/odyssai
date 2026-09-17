import type { LlmClient } from '@odyssai/llm';
import { ModerationVerdictSchema, type ModerationVerdict, type UiLocale } from '@odyssai/schemas';
import { MODERATION_PROMPT } from '../prompts/moderation/v1.js';

export const MODERATION_PROMPT_VERSION = MODERATION_PROMPT.id;

export interface ModerateRequest {
  llm: LlmClient;
  config: { model: string; temperature: number; maxOutputTokens: number };
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
export async function moderate(
  request: ModerateRequest,
): Promise<ModerationVerdict> {
  let text = '';

  for await (const event of request.llm.streamChat({
    model: request.config.model,
    messages: MODERATION_PROMPT.build(request.locale, request.text),
    maxOutputTokens: request.config.maxOutputTokens,
    temperature: request.config.temperature,
    signal: request.signal,
  })) {
    if (event.type === 'text') text += event.text;
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);

  try {
    const parsed = ModerationVerdictSchema.safeParse(
      JSON.parse((fenced?.[1] ?? text).trim()),
    );
    return parsed.success ? parsed.data : { allow: true, reason: null };
  } catch {
    return { allow: true, reason: null };
  }
}
