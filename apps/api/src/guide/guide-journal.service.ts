import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { UiLocale } from '@odyssai/schemas';
import { GuideConfig } from '../config/guide-config.js';
import { PRISMA } from '../prisma/prisma.module.js';
import { PrismaClient, type GuideSource } from '@odyssai/db';

export interface JournalEntry {
  id: string;
  locale: UiLocale;
  question: string;
  normalizedHash: string;
  source: GuideSource;
  faqEntryId?: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  traced: boolean;
  // Uniquement pour les reponses generees, jamais pour les textes fixes.
  answer?: string;
  promptVersion: string;
  corpusVersion: string;
}

@Injectable()
export class GuideJournalService implements OnModuleInit {
  private readonly logger = new Logger(GuideJournalService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly config: GuideConfig,
  ) {}

  onModuleInit(): void {
    this.logger.log(
      `journal du guide, retention ${this.config.logRetentionDays} jours`,
    );
  }

  /*
    Une erreur d'ecriture est journalisee, jamais relancee : le visiteur a
    deja recu sa reponse, et le journal ne vaut pas de casser le flux.
  */
  async record(entry: JournalEntry): Promise<void> {
    try {
      await this.prisma.guideQuestion.create({
        data: {
          id: entry.id,
          locale: entry.locale,
          question: entry.question,
          normalizedHash: entry.normalizedHash,
          source: entry.source,
          faqEntryId: entry.faqEntryId ?? null,
          provider: entry.provider ?? null,
          model: entry.model ?? null,
          inputTokens: entry.inputTokens ?? null,
          outputTokens: entry.outputTokens ?? null,
          reasoningTokens: entry.reasoningTokens ?? null,
          costUsd: entry.costUsd ?? null,
          traced: entry.traced,
          answer: entry.answer ?? null,
          promptVersion: entry.promptVersion,
          corpusVersion: entry.corpusVersion,
        },
      });
    } catch (error: unknown) {
      this.logger.warn(`journal du guide non ecrit : ${String(error)}`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purge(): Promise<void> {
    const cutoff = new Date(
      Date.now() - this.config.logRetentionDays * 86_400_000,
    );

    try {
      const { count } = await this.prisma.guideQuestion.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (count > 0) this.logger.log(`${count} questions purgees du journal`);
    } catch (error: unknown) {
      this.logger.warn(`purge du journal en echec : ${String(error)}`);
    }
  }
}
