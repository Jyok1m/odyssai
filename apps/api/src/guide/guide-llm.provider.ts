import { Logger } from '@nestjs/common';
import { createLlmClient, type LlmClient } from '@odyssai/llm';
import { GuideConfig } from '../config/guide-config.js';

export const GUIDE_LLM = Symbol('GUIDE_LLM');

/*
  Seul endroit ou la cle du fournisseur sort de la configuration.

  Plus de client LangSmith : c'est OpenRouter qui diffuse les traces vers la
  destination configuree chez lui, et qui seul connait le cout reel et le
  fournisseur vers lequel il a route. Le code n'emet plus rien, il pose
  seulement ses metadonnees dans le corps de la requete.
*/
export const guideLlmProvider = {
  provide: GUIDE_LLM,
  inject: [GuideConfig],
  useFactory: (config: GuideConfig): LlmClient => {
    new Logger('GuideLlm').log(`guide sur ${config.provider}`);

    return createLlmClient({
      provider: config.provider,
      apiKey: config.apiKey,
    });
  },
};
