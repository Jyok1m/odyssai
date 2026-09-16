import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { UiLocale } from '@odyssai/schemas';
import { findFaqAnswer, loadFaq, type FaqEntry, type FaqIndex } from '@odyssai/narrator';

const LOCALES: UiLocale[] = ['fr', 'en'];

/**
 * FAQ chargee une fois au demarrage. Un fichier invalide ou une formulation en
 * double fait echouer le bootstrap, pas la premiere question d'un visiteur.
 */
@Injectable()
export class GuideFaqService implements OnModuleInit {
  private readonly logger = new Logger(GuideFaqService.name);
  private readonly indexes = new Map<UiLocale, FaqIndex>();

  onModuleInit(): void {
    for (const locale of LOCALES) {
      const index = loadFaq(locale);
      this.indexes.set(locale, index);
      this.logger.log(
        `FAQ ${locale} : ${index.byHash.size} formulations validees, ${index.suggestions.length} suggestions`,
      );
    }
  }

  find(locale: UiLocale, question: string): FaqEntry | undefined {
    const index = this.indexes.get(locale);
    return index ? findFaqAnswer(index, locale, question) : undefined;
  }

  suggestions(locale: UiLocale): { id: string; question: string }[] {
    return this.indexes.get(locale)?.suggestions ?? [];
  }
}
