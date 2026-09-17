import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';

/** AuthModule apporte SessionGuard et ce qu'il lui faut pour se construire. */
@Module({
  imports: [AuthModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
