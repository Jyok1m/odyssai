/*
  Registre des fournisseurs, code en dur. Aucune variable d'environnement ne
  porte une URL de fournisseur : une URL configurable est une URL qu'un
  environnement mal rempli peut detourner avec la cle qui va avec.
*/
export type LlmProvider = 'openrouter' | 'openai';

export interface ProviderSpec {
  baseUrl: string;
  /*
    Les modeles de raisonnement d'OpenAI en direct refusent `max_tokens` et
    n'acceptent que `max_completion_tokens`. OpenRouter, lui, normalise sur
    `max_tokens`.
  */
  maxOutputTokensParam: 'max_tokens' | 'max_completion_tokens';
}

export const LLM_PROVIDERS: Record<LlmProvider, ProviderSpec> = {
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    maxOutputTokensParam: 'max_tokens',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    maxOutputTokensParam: 'max_completion_tokens',
  },
};

// Cles de corps propres a OpenRouter, que l'API d'OpenAI rejette.
export const OPENROUTER_ONLY_BODY_KEYS = [
  'models',
  'provider',
  'reasoning',
  'route',
  'transforms',
  'usage',
] as const;
