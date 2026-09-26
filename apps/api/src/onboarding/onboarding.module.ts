import { Module, forwardRef } from '@nestjs/common';
import { AlphaModule } from '../alpha/alpha.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ErasureModule } from '../erasure/erasure.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { PartyModule } from '../party/party.module.js';
import { StoriesController } from '../stories/stories.controller.js';
import { StoriesModule } from '../stories/stories.module.js';
import { CharacterController } from './character.controller.js';
import { CharacterService } from './character.service.js';
import { GenerationController } from './generation.controller.js';
import { OpenWorldsController } from './open-worlds.controller.js';
import { GenerationQueueService } from './generation-queue.service.js';
import { GenerationRefundService } from './generation-refund.service.js';
import { NARRATOR_LLM, narratorLlmProvider } from './narrator-llm.provider.js';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';

// AuthModule apporte SessionGuard et ce qu'il lui faut pour se construire.
@Module({
  imports: [
    AuthModule,
    AlphaModule,
    ErasureModule,
    PartyModule,
    StoriesModule,
    forwardRef(() => ModerationModule),
  ],
  controllers: [
    OnboardingController,
    CharacterController,
    GenerationController,
    OpenWorldsController,
    StoriesController,
  ],
  providers: [
    OnboardingService,
    CharacterService,
    GenerationQueueService,
    GenerationRefundService,
    narratorLlmProvider,
  ],
  exports: [OnboardingService, NARRATOR_LLM],
})
export class OnboardingModule {}
