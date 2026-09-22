import { createLlmClient, type LlmClient } from '@odyssai/llm';
import { NarratorConfig } from '../config/narrator-config.js';

export const NARRATOR_LLM = Symbol('NARRATOR_LLM');

// Le client est le meme pour tous les roles : seul le modele change, par appel.
export const narratorLlmProvider = {
  provide: NARRATOR_LLM,
  inject: [NarratorConfig],
  useFactory: (config: NarratorConfig): LlmClient => {

    return createLlmClient({
      provider: config.provider,
      apiKey: config.apiKey,
    });
  },
};
