import { Logger } from '@nestjs/common';
import { Client } from 'langsmith';
import { createLlmClient, type LlmClient } from '@odyssai/llm';
import { GuideConfig } from '../config/guide-config.js';

export const GUIDE_LLM = Symbol('GUIDE_LLM');

/**
 * Seul endroit ou la cle du fournisseur sort de la configuration. Le client
 * LangSmith n'est construit que si le tracing est actif : sans instance tracee,
 * aucune trace ne peut partir, quoi que dise l'environnement.
 */
export const guideLlmProvider = {
  provide: GUIDE_LLM,
  inject: [GuideConfig],
  useFactory: (config: GuideConfig): LlmClient => {
    const logger = new Logger('GuideLlm');
    const { tracing } = config;

    if (!tracing.enabled) {
      logger.log(`guide sur ${config.provider}, sans tracing`);
      return createLlmClient({
        provider: config.provider,
        apiKey: config.apiKey,
      });
    }

    const client = new Client({
      apiUrl: tracing.endpoint,
      apiKey: tracing.apiKey,
      workspaceId: tracing.workspaceId,
      // Les traces gardent metadonnees et usage, sans le texte.
      hideInputs: tracing.hideIo,
      hideOutputs: tracing.hideIo,
    });

    logger.log(
      `guide sur ${config.provider}, tracing vers ${tracing.project} a ${tracing.sampleRate * 100} %`,
    );

    return createLlmClient({
      provider: config.provider,
      apiKey: config.apiKey,
      tracing: {
        client,
        projectName: tracing.project,
        sampleRate: tracing.sampleRate,
      },
    });
  },
};
