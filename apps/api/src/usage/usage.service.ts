import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@odyssai/db';
import { PRISMA } from '../prisma/prisma.module.js';

/** Ce que tous les points d'appel rendent deja, sous un nom ou un autre. */
export interface RecordedUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
}

export type UsageKind =
  | 'turn'
  | 'moderation'
  | 'embedding'
  | 'character'
  | 'extract'
  | 'abstraction'
  | 'generation';

export interface UsageEntry {
  kind: UsageKind;
  provider: string;
  userId?: string | null;
  universeId?: string | null;
  usage: RecordedUsage;
  /** Prix du modele, pour calculer le cout quand le fournisseur ne le rend pas. */
  prices?: { inputUsdPerMTok: number; outputUsdPerMTok: number };
}

/**
 * Le journal de ce que les modeles coutent.
 *
 * Cinq des huit points d'appel jetaient leur usage, alors que narrator le
 * calculait deja. Sans ce journal, aucun barème d'abonnement ne peut etre
 * autre chose qu'une opinion.
 *
 * Une ecriture ratee est journalisee, jamais relancee : le joueur a deja recu
 * sa reponse, et la comptabilite ne vaut pas de casser un tour. C'est la meme
 * regle que le journal du guide.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /**
   * Le cout rendu par le fournisseur d'abord, le calcul par les jetons sinon.
   * Les jetons de raisonnement sont factures au tarif de sortie chez les deux.
   */
  static cost(
    usage: RecordedUsage,
    prices?: { inputUsdPerMTok: number; outputUsdPerMTok: number },
  ): number | undefined {
    if (typeof usage.costUsd === 'number') return usage.costUsd;
    if (!prices || usage.inputTokens === undefined) return undefined;

    const output = (usage.outputTokens ?? 0) + (usage.reasoningTokens ?? 0);
    return (
      (usage.inputTokens * prices.inputUsdPerMTok + output * prices.outputUsdPerMTok) /
      1e6
    );
  }

  async record(entry: UsageEntry): Promise<void> {
    // Un appel qui n'a rien rapporte n'a rien a journaliser : une ligne a zero
    // mentirait sur la consommation reelle.
    if (entry.usage.inputTokens === undefined) return;

    const cost = UsageService.cost(entry.usage, entry.prices);

    try {
      await this.prisma.llmUsage.create({
        data: {
          kind: entry.kind,
          provider: entry.provider,
          userId: entry.userId ?? null,
          universeId: entry.universeId ?? null,
          model: entry.usage.model ?? 'inconnu',
          inputTokens: entry.usage.inputTokens,
          outputTokens: entry.usage.outputTokens ?? 0,
          reasoningTokens: entry.usage.reasoningTokens ?? null,
          costUsd: cost === undefined ? null : new Prisma.Decimal(cost.toFixed(8)),
        },
      });
    } catch (error: unknown) {
      this.logger.warn(`usage non journalise (${entry.kind}) : ${String(error)}`);
    }
  }
}
