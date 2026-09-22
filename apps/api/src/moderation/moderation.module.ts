import { Module } from '@nestjs/common';
import { OnboardingModule } from '../onboarding/onboarding.module.js';
import { ModerationService } from './moderation.service.js';

// OnboardingModule fournit NARRATOR_LLM, deja construit et trace.
@Module({
  imports: [OnboardingModule],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
