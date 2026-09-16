import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import type { LlmClient } from '@odyssai/llm';
import { GuideBudgetService } from './guide-budget.service.js';
import { GuideController } from './guide.controller.js';
import { GuideFaqService } from './guide-faq.service.js';
import { GuideJournalService } from './guide-journal.service.js';
import { GuideLimitsService } from './guide-limits.service.js';
import { GuidePassService } from './guide-pass.service.js';
import { GUIDE_LLM, guideLlmProvider } from './guide-llm.provider.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [GuideController],
  providers: [
    GuideBudgetService,
    GuideFaqService,
    GuideJournalService,
    GuideLimitsService,
    GuidePassService,
    guideLlmProvider,
  ],
})
export class GuideModule implements OnApplicationShutdown {
  constructor(@Inject(GUIDE_LLM) private readonly llm: LlmClient) {}

  /** Sans ce vidage, les derniers lots de traces partent avec le processus. */
  async onApplicationShutdown(): Promise<void> {
    await this.llm.flushTraces();
  }
}
