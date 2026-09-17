import { Global, Module } from '@nestjs/common';
import { AppConfig } from './app-config.js';
import { GuideConfig } from './guide-config.js';
import { NarratorConfig } from './narrator-config.js';

@Global()
@Module({
  // NarratorConfig est fourni sans qu'aucune route ne le lise encore : c'est
  // ce qui fait echouer un LLM_NARRATOR_EXTRA_BODY invalide au demarrage,
  // plutot qu'au premier monde genere.
  providers: [AppConfig, GuideConfig, NarratorConfig],
  exports: [AppConfig, GuideConfig, NarratorConfig],
})
export class ConfigModule {}
