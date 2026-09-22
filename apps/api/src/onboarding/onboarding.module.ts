import { Module, forwardRef } from '@nestjs/common';
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
export class OnboardingModule {}
