import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { GuideBudgetService } from './guide-budget.service.js';
import { GuideController } from './guide.controller.js';
import { GuideFaqService } from './guide-faq.service.js';
import { GuideJournalService } from './guide-journal.service.js';
import { GuideLimitsService } from './guide-limits.service.js';
import { GuidePassService } from './guide-pass.service.js';
import { GuidePricingService } from './guide-pricing.service.js';
import { guideLlmProvider } from './guide-llm.provider.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [GuideController],
  providers: [
    GuideBudgetService,
    GuideFaqService,
    GuideJournalService,
    GuideLimitsService,
    GuidePassService,
    GuidePricingService,
    guideLlmProvider,
  ],
})
export class GuideModule {}
