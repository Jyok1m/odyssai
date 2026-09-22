import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { GuideConfig } from '../config/guide-config.js';
import { REDIS } from '../redis/redis.module.js';

// Jour UTC, aligne sur la remise a zero du plafond OpenRouter.
const BUDGET_TTL_SECONDS = 172_800;

/*
  Le ratio est volontairement pessimiste : trois caracteres par token surestime
  le francais, et un budget qui se trompe doit se tromper vers le haut.
*/
const CHARS_PER_TOKEN = 3;

export const RESERVE_BUDGET = `
local spent = tonumber(redis.call('GET', KEYS[1]) or '0')
local reserved = tonumber(redis.call('GET', KEYS[2]) or '0')
local estimate = tonumber(ARGV[1])
if spent + reserved + estimate > tonumber(ARGV[2]) then return 0 end
redis.call('INCRBYFLOAT', KEYS[2], estimate)
redis.call('HSET', KEYS[3], ARGV[3], estimate)
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('EXPIRE', KEYS[2], ARGV[4])
redis.call('EXPIRE', KEYS[3], ARGV[4])
return 1
`;

/*
  Retire la reservation et ajoute le cout reel. ARGV[2] vide signifie qu'aucun
  usage n'est remonte : on retient alors le montant reserve, du cote prudent.
*/
export const SETTLE_BUDGET = `
local reserved = redis.call('HGET', KEYS[3], ARGV[1])
if reserved then
  redis.call('INCRBYFLOAT', KEYS[2], -tonumber(reserved))
  redis.call('HDEL', KEYS[3], ARGV[1])
end
local real = ARGV[2]
if real == '' then real = reserved or '0' end
redis.call('INCRBYFLOAT', KEYS[1], real)
redis.call('EXPIRE', KEYS[1], ARGV[3])
return real
`;

export interface UsageForBudget {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  costUsd?: number;
}

@Injectable()
export class GuideBudgetService {
  private readonly logger = new Logger(GuideBudgetService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: GuideConfig,
  ) {}

  // Majorant du cout d'un tour, avant de savoir ce qu'il coutera vraiment.
  estimate(promptChars: number): number {
    const { inputUsdPerMTok, outputUsdPerMTok } = this.config.prices;
    const inputTokens = Math.ceil(promptChars / CHARS_PER_TOKEN);
    const outputTokens = this.config.model.maxOutputTokens;

    return (
      (inputTokens * inputUsdPerMTok + outputTokens * outputUsdPerMTok) / 1e6
    );
  }

  async reserve(
    requestId: string,
    estimate: number,
    now: number = Date.now(),
  ): Promise<boolean> {
    const keys = this.keys(now);
    const granted = await this.redis.eval(
      RESERVE_BUDGET,
      3,
      keys.spent,
      keys.reserved,
      keys.reservations,
      estimate.toFixed(8),
      String(this.config.dailyBudgetUsd),
      requestId,
      String(BUDGET_TTL_SECONDS),
    );
    return Number(granted) === 1;
  }

  /*
    Cout reel, par ordre de preference : celui rendu par le fournisseur, sinon
    le calcul a partir des tokens, sinon le montant reserve.
  */
  async settle(
    requestId: string,
    usage: UsageForBudget | undefined,
    now: number = Date.now(),
  ): Promise<void> {
    const keys = this.keys(now);
    const real = this.realCost(usage);

    try {
      await this.redis.eval(
        SETTLE_BUDGET,
        3,
        keys.spent,
        keys.reserved,
        keys.reservations,
        requestId,
        real === undefined ? '' : real.toFixed(8),
        String(BUDGET_TTL_SECONDS),
      );
    } catch (error: unknown) {
      // Une reservation orpheline reste comptee jusqu'a expiration de la cle :
      // c'est une erreur du cote prudent, et c'est voulu.
      this.logger.warn(`reglement du budget en echec : ${String(error)}`);
    }
  }

  realCost(usage: UsageForBudget | undefined): number | undefined {
    if (!usage) return undefined;
    if (typeof usage.costUsd === 'number') return usage.costUsd;

    const { inputUsdPerMTok, outputUsdPerMTok } = this.config.prices;
    const output = usage.outputTokens + (usage.reasoningTokens ?? 0);
    return (usage.inputTokens * inputUsdPerMTok + output * outputUsdPerMTok) / 1e6;
  }

  private keys(now: number) {
    const day = new Date(now).toISOString().slice(0, 10);
    return {
      spent: `guide:budget:${day}:spent`,
      reserved: `guide:budget:${day}:reserved`,
      reservations: `guide:budget:${day}:reservations`,
    };
  }
}
