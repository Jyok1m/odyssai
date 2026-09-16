import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { GuideConfig } from '../config/guide-config.js';
import { REDIS } from '../redis/redis.module.js';

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SITEVERIFY_TIMEOUT_MS = 5_000;
const PASS_PREFIX = 'guide:pass:';

const SiteverifyResponse = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.string()).optional(),
});

/** Decremente et refuse a zero, sans laisser passer deux requetes simultanees. */
export const CONSUME_PASS = `
local left = tonumber(redis.call('GET', KEYS[1]) or '-1')
if left < 1 then return -1 end
return redis.call('DECR', KEYS[1])
`;

@Injectable()
export class GuidePassService {
  private readonly logger = new Logger(GuidePassService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: GuideConfig,
  ) {}

  /**
   * En cas de panne reseau on refuse plutot que de laisser passer : un
   * siteverify injoignable ne doit pas ouvrir la porte a tout le monde.
   */
  async verifyTurnstile(token: string, ip?: string): Promise<boolean> {
    const body = new URLSearchParams({
      secret: this.config.pass.turnstileSecret,
      response: token,
    });
    if (ip) body.set('remoteip', ip);

    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    }).catch((error: unknown) => {
      this.logger.warn(`siteverify injoignable : ${String(error)}`);
      throw new ServiceUnavailableException('pass_unavailable');
    });

    if (!response.ok) {
      this.logger.warn(`siteverify en echec (HTTP ${response.status})`);
      throw new ServiceUnavailableException('pass_unavailable');
    }

    const parsed = SiteverifyResponse.safeParse(await response.json());
    if (!parsed.success) {
      this.logger.warn('reponse siteverify illisible');
      throw new ServiceUnavailableException('pass_unavailable');
    }

    if (!parsed.data.success) {
      this.logger.warn(
        `defi refuse : ${(parsed.data['error-codes'] ?? []).join(', ')}`,
      );
    }
    return parsed.data.success;
  }

  async issue(): Promise<string> {
    const id = randomBytes(32).toString('base64url');
    await this.redis.set(
      `${PASS_PREFIX}${id}`,
      String(this.config.pass.questions),
      'EX',
      this.config.pass.ttlSeconds,
    );
    return id;
  }

  /** Rend le nombre de questions restantes, ou null si le pass est epuise. */
  async consume(id: string): Promise<number | null> {
    const left = await this.redis.eval(CONSUME_PASS, 1, `${PASS_PREFIX}${id}`);
    const value = Number(left);
    return value < 0 ? null : value;
  }
}
