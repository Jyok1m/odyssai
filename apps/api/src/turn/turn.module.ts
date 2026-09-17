import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OnboardingModule } from '../onboarding/onboarding.module.js';
import { TurnController } from './turn.controller.js';
import { TurnLimitsService } from './turn-limits.service.js';
import { TurnMemoryService } from './turn-memory.service.js';

/** OnboardingModule fournit NARRATOR_LLM, deja construit et trace. */
@Module({
  imports: [AuthModule, OnboardingModule],
  controllers: [TurnController],
  providers: [TurnMemoryService, TurnLimitsService],
})
export class TurnModule {}
