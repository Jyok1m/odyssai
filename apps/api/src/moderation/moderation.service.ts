import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LlmClient } from '@odyssai/llm';
import { moderate } from '@odyssai/narrator';
import { screenText } from '@odyssai/engine';
import type { ModerationVerdict, UiLocale } from '@odyssai/schemas';
import { NarratorConfig } from '../config/narrator-config.js';
import { NARRATOR_LLM } from '../onboarding/narrator-llm.provider.js';
import { UsageService } from '../usage/usage.service.js';

/**
 * Deux couches, dans cet ordre.
 *
 * La lexicale d'abord : instantanee, gratuite, elle arrete ce qui est
 * manifeste sans qu'aucun octet ne sorte. Le classificateur ensuite, qui lit
 * la phrase entiere et tranche ce qu'une liste de mots ne saura jamais
 * trancher : une scene dure contre une scene obscene, un juron adresse a une
 * situation contre une insulte adressee a quelqu'un.
 *
 * Aucun point de moderation dedie n'est joignable avec les cles du projet :
 * OpenRouter ne sert pas /moderations et la cle OpenAI est vide. Le
 * classificateur est donc un petit modele de conversation, ce qui coute un
 * appel par message.
 */
/** Laisser passer, et sans avis sur la langue. */
const OPEN: ModerationVerdict = { allow: true, reason: null, language: null };

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    @Inject(NARRATOR_LLM) private readonly llm: LlmClient,
    private readonly config: NarratorConfig,
    private readonly usage: UsageService,
  ) {}

  /** `userId` sert au journal : la moderation n'est jamais facturee au
   * joueur, mais elle coute, et ce cout doit se voir. */
  async check(
    text: string,
    locale: UiLocale,
    userId?: string,
  ): Promise<ModerationVerdict> {
    const hits = screenText(text);
    if (hits.length > 0) {
      // Le mot reconnu reste dans le journal du serveur, jamais dans la
      // reponse : le renvoyer au joueur reviendrait a le republier.
      this.logger.log(`refus lexical : ${hits[0]!.match}`);
      return { allow: false, reason: 'insulte', language: null };
    }

    if (!this.config.moderation.enabled) return OPEN;

    try {
      const { verdict, usage } = await moderate({
        llm: this.llm,
        config: this.config.moderation,
        locale,
        text,
      });

      await this.usage.record({
        kind: 'moderation',
        provider: this.config.provider,
        userId,
        usage,
      });

      if (!verdict.allow) this.logger.log(`refus du classificateur : ${verdict.reason}`);
      return verdict;
    } catch (error: unknown) {
      // Un classificateur injoignable ne doit pas empecher de jouer : la
      // couche lexicale a deja tourne, et elle seule arrete l'evidence.
      this.logger.warn(`classificateur indisponible : ${String(error)}`);
      return OPEN;
    }
  }

  /** Le texte du modele : la couche lexicale seule, sans appel ni latence. */
  clean(text: string): boolean {
    return screenText(text).length === 0;
  }
}
