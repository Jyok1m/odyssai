import { Logger } from '@nestjs/common';
import { createLlmClient, type LlmClient } from '@odyssai/llm';
import { NarratorConfig } from '../config/narrator-config.js';

export const NARRATOR_LLM = Symbol('NARRATOR_LLM');

/*
  Construit meme sans modele retenu : c'est le controleur qui refuse, avec un
  code que le front sait lire, plutot qu'une injection qui echoue au demarrage.
*/
export const narratorLlmProvider = {
  provide: NARRATOR_LLM,
  inject: [NarratorConfig],
  useFactory: (config: NarratorConfig): LlmClient => {
    if (!config.configured) {
      new Logger('NarratorLlm').warn(
        'LLM_NARRATOR_MODEL est vide : la creation de personnage repondra indisponible',
      );
    }

    return createLlmClient({
      provider: config.provider,
      apiKey: config.apiKey,
    });
  },
};
