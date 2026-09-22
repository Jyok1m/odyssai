import { Logger } from '@nestjs/common';
import { Client } from 'langsmith';
import { createLlmClient, type LlmClient } from '@odyssai/llm';
import { GuideConfig } from '../config/guide-config.js';
import { NarratorConfig } from '../config/narrator-config.js';

export const NARRATOR_LLM = Symbol('NARRATOR_LLM');

/*
  Les coordonnees LangSmith viennent de `GuideConfig` : ce sont celles du
  compte, pas celles du guide.

  Construit meme sans modele retenu : c'est le controleur qui refuse, avec un
  code que le front sait lire, plutot qu'une injection qui echoue au demarrage.
*/
export const narratorLlmProvider = {
  provide: NARRATOR_LLM,
  inject: [NarratorConfig, GuideConfig],
  useFactory: (config: NarratorConfig, guide: GuideConfig): LlmClient => {
    const logger = new Logger('NarratorLlm');
    const { tracing } = guide;

    if (!config.configured) {
      logger.warn(
        'LLM_NARRATOR_MODEL est vide : la creation de personnage repondra indisponible',
      );
    }

    if (!tracing.enabled) {
      return createLlmClient({
        provider: config.provider,
        apiKey: config.apiKey,
      });
    }

    return createLlmClient({
      provider: config.provider,
      apiKey: config.apiKey,
      tracing: {
        client: new Client({
          apiUrl: tracing.endpoint,
          apiKey: tracing.apiKey,
          workspaceId: tracing.workspaceId,
          // Les traces gardent metadonnees et usage, sans le texte : la
          // conversation est deja chez nous, dans conversation_messages.
          hideInputs: tracing.hideIo,
          hideOutputs: tracing.hideIo,
        }),
        projectName: tracing.project,
        sampleRate: tracing.sampleRate,
      },
    });
  },
};
