import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';
import { NarratorConfig } from '../config/narrator-config.js';
import { INCREMENT_WINDOWS } from '../guide/guide-limits.service.js';

export interface TurnVerdict {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/*
  Fenetres horaire et journaliere par joueur. Le script Lua est celui du
  guide, importe et non recopie : il ne connait que ses cles. La cle est ici
  l'identifiant du joueur, l'anonymisation HMAC n'ayant plus d'objet pour un
  authentifie.

  Le guide garde son service : les fusionner demanderait de defaire son
  couplage a `GuideConfig`, dont un tour de jeu n'a que faire.
*/
@Injectable()
export class TurnLimitsService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: NarratorConfig,
  ) {}

  async consume(userId: string, now: number = Date.now()): Promise<TurnVerdict> {
    const hour = Math.floor(now / 3_600_000);
    const day = Math.floor(now / 86_400_000);

    const [hourCount, dayCount, hourTtl, dayTtl] = (await this.redis.eval(
      INCREMENT_WINDOWS,
      2,
      `turn:rl:${userId}:h:${hour}`,
      `turn:rl:${userId}:d:${day}`,
      '3600',
      '86400',
    )) as [number, number, number, number];

    const { perHour, perDay } = this.config.turnLimits;

    if (dayCount > perDay) {
      return { allowed: false, retryAfterSeconds: Math.max(1, dayTtl) };
    }
    if (hourCount > perHour) {
      return { allowed: false, retryAfterSeconds: Math.max(1, hourTtl) };
    }

    return { allowed: true };
  }
}
