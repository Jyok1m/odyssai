import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { Redis } from 'ioredis';
import { GuideConfig } from '../config/guide-config.js';
import { REDIS } from '../redis/redis.module.js';

const WINDOW_PREFIX = 'guide:rl';
const INFLIGHT_KEY = 'guide:inflight';

// Deux heures et vingt-cinq heures : une fenetre survit toujours a son bucket.
const HOUR_TTL_SECONDS = 7_200;
const DAY_TTL_SECONDS = 90_000;

// Au-dela, un creneau est forcement le reliquat d'un processus disparu.
const INFLIGHT_MAX_AGE_MS = 120_000;

/*
  Incremente les deux fenetres et rend leur compte avec leur duree restante.
  EXPIRE seulement a la premiere incrementation, sinon la fenetre glisserait a
  chaque requete et ne se fermerait jamais.
*/
export const INCREMENT_WINDOWS = `
local hour = redis.call('INCR', KEYS[1])
if hour == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local day = redis.call('INCR', KEYS[2])
if day == 1 then redis.call('EXPIRE', KEYS[2], ARGV[2]) end
return { hour, day, redis.call('TTL', KEYS[1]), redis.call('TTL', KEYS[2]) }
`;

/*
  Reserve un creneau de concurrence. La purge par anciennete evite qu'un arret
  brutal bloque des creneaux indefiniment.
*/
export const ACQUIRE_SLOT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
return 1
`;

export interface RateVerdict {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/*
  Cle de limitation a partir d'une adresse. IPv6 ramene a son /64 : un abonne
  en recoit un entier, limiter l'adresse complete ne limiterait rien.
*/
export function rateLimitKey(ip: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(normalizeIp(ip))
    .digest('hex')
    .slice(0, 32);
}

function normalizeIp(raw: string): string {
  let parsed;
  try {
    parsed = ipaddr.parse(raw.trim());
  } catch {
    // Adresse illisible : on la prend telle quelle plutot que de confondre
    // tous les appelants sous une meme cle.
    return raw.trim();
  }

  if (parsed.kind() === 'ipv6') {
    const v6 = parsed as ipaddr.IPv6;
    // ::ffff:a.b.c.d est une IPv4 deguisee, ramenee a sa forme d'origine.
    if (v6.isIPv4MappedAddress()) return v6.toIPv4Address().toString();
    return `${v6.toNormalizedString().split(':').slice(0, 4).join(':')}::/64`;
  }

  return parsed.toString();
}

@Injectable()
export class GuideLimitsService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: GuideConfig,
  ) {}

  key(ip: string): string {
    return rateLimitKey(ip, this.config.limits.ipHashSecret);
  }

  // Fenetre horaire et fenetre journaliere, incrementees ensemble.
  async consume(hashedIp: string, now: number = Date.now()): Promise<RateVerdict> {
    const hourBucket = Math.floor(now / 3_600_000);
    const dayBucket = new Date(now).toISOString().slice(0, 10);

    const raw = (await this.redis.eval(
      INCREMENT_WINDOWS,
      2,
      `${WINDOW_PREFIX}:h:${hashedIp}:${hourBucket}`,
      `${WINDOW_PREFIX}:d:${hashedIp}:${dayBucket}`,
      String(HOUR_TTL_SECONDS),
      String(DAY_TTL_SECONDS),
    )) as [number, number, number, number];

    const [hour, day, hourTtl, dayTtl] = raw.map(Number) as [
      number,
      number,
      number,
      number,
    ];

    if (day > this.config.limits.perDay) {
      return { allowed: false, retryAfterSeconds: Math.max(1, dayTtl) };
    }
    if (hour > this.config.limits.perHour) {
      return { allowed: false, retryAfterSeconds: Math.max(1, hourTtl) };
    }
    return { allowed: true };
  }

  // Limite propre au pass : sinon /guide/pass permet de spammer siteverify.
  async consumePass(hashedIp: string, now: number = Date.now()): Promise<RateVerdict> {
    const hourBucket = Math.floor(now / 3_600_000);

    const raw = (await this.redis.eval(
      INCREMENT_WINDOWS,
      2,
      `${WINDOW_PREFIX}:pass:h:${hashedIp}:${hourBucket}`,
      `${WINDOW_PREFIX}:pass:d:${hashedIp}:${hourBucket}`,
      String(HOUR_TTL_SECONDS),
      String(HOUR_TTL_SECONDS),
    )) as [number, number, number, number];

    const [hour, , hourTtl] = raw.map(Number) as [number, number, number, number];
    if (hour > this.config.limits.perHour) {
      return { allowed: false, retryAfterSeconds: Math.max(1, hourTtl) };
    }
    return { allowed: true };
  }

  async acquireSlot(requestId: string, now: number = Date.now()): Promise<boolean> {
    const acquired = await this.redis.eval(
      ACQUIRE_SLOT,
      1,
      INFLIGHT_KEY,
      String(now - INFLIGHT_MAX_AGE_MS),
      String(this.config.limits.maxConcurrent),
      String(now),
      requestId,
    );
    return Number(acquired) === 1;
  }

  async releaseSlot(requestId: string): Promise<void> {
    await this.redis.zrem(INFLIGHT_KEY, requestId);
  }
}
