import { Module, forwardRef, type OnApplicationShutdown, Inject } from '@nestjs/common';
import type { LlmClient } from '@odyssai/llm';
import { AuthModule } from '../auth/auth.module.js';
import { ErasureModule } from '../erasure/erasure.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { CharacterController } from './character.controller.js';
import { CharacterService } from './character.service.js';
import { GenerationController } from './generation.controller.js';
import { GenerationQueueService } from './generation-queue.service.js';
import { NARRATOR_LLM, narratorLlmProvider } from './narrator-llm.provider.js';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';

// AuthModule apporte SessionGuard et ce qu'il lui faut pour se construire.
@Module({
  imports: [AuthModule, ErasureModule, forwardRef(() => ModerationModule)],
  controllers: [OnboardingController, CharacterController, GenerationController],
  providers: [
    OnboardingService,
    CharacterService,
    GenerationQueueService,
    narratorLlmProvider,
  ],
  exports: [OnboardingService, NARRATOR_LLM],
})
export class OnboardingModule implements OnApplicationShutdown {
  constructor(@Inject(NARRATOR_LLM) private readonly llm: LlmClient) {}

  // Sans ce vidage, les derniers lots de traces partent avec le processus.
  async onApplicationShutdown(): Promise<void> {
    await this.llm.flushTraces();
  }
}
