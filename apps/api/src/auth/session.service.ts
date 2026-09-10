import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { REDIS } from '../redis/redis.module.js';
import {
  OidcService,
  type TokenSet,
  type VerifiedIdentity,
} from './oidc.service.js';

const TX_PREFIX = 'odyssai:oauth:tx:';
const SESSION_PREFIX = 'odyssai:session:';
const LOCK_PREFIX = 'odyssai:session:lock:';

/** Duree de vie d'un aller-retour vers Keycloak. */
const TX_TTL_SECONDS = 600;
/** Marge avant expiration en deca de laquelle on renouvelle par anticipation. */
const REFRESH_MARGIN_MS = 30_000;
const LOCK_TTL_MS = 5_000;
const LOCK_WAIT_ATTEMPTS = 20;
const LOCK_WAIT_MS = 100;

const Transaction = z.object({
  codeVerifier: z.string().min(1),
  nonce: z.string().min(1),
  redirectTo: z.string().min(1),
});

export type Transaction = z.infer<typeof Transaction>;

const StoredSession = z.object({
  sub: z.string().min(1),
  email: z.email(),
  emailVerified: z.boolean(),
  roles: z.array(z.string()),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  idToken: z.string().min(1),
  accessExpiresAt: z.number().int(),
  refreshExpiresAt: z.number().int(),
});

export type StoredSession = z.infer<typeof StoredSession>;

/**
 * Libere un verrou seulement si on en est encore proprietaire : un GET suivi
 * d'un DEL laisserait la place a une expiration entre les deux.
 */
const RELEASE_LOCK = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

/**
 * Sessions serveur. Le navigateur ne detient qu'un identifiant opaque : les
 * jetons restent dans Redis, hors de portee d'un script injecte dans la page.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly oidc: OidcService,
  ) {}

  /** Prepare un aller vers Keycloak : state, nonce et couple PKCE. */
  async startTransaction(
    redirectTo: string,
  ): Promise<{ state: string; nonce: string; codeChallenge: string }> {
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken();

    const transaction: Transaction = { codeVerifier, nonce, redirectTo };
    await this.redis.set(
      `${TX_PREFIX}${state}`,
      JSON.stringify(transaction),
      'EX',
      TX_TTL_SECONDS,
    );

    return {
      state,
      nonce,
      codeChallenge: createHash('sha256')
        .update(codeVerifier)
        .digest('base64url'),
    };
  }

  /**
   * Lit et supprime la transaction dans la meme operation : un code
   * d'autorisation rejoue ne trouve plus rien.
   */
  async consumeTransaction(state: string): Promise<Transaction | null> {
    const raw = await this.redis.getdel(`${TX_PREFIX}${state}`);
    if (!raw) return null;

    const parsed = Transaction.safeParse(safeJsonParse(raw));
    return parsed.success ? parsed.data : null;
  }

  /** Ouvre une session a partir des jetons fraichement obtenus. */
  async create(tokens: TokenSet, identity: VerifiedIdentity): Promise<string> {
    const id = randomToken();
    await this.write(id, toStoredSession(tokens, identity));
    return id;
  }

  /** Session courante, renouvelee si l'access token arrive a echeance. */
  async read(id: string): Promise<StoredSession | null> {
    const session = await this.peek(id);
    if (!session) return null;
    if (Date.now() < session.accessExpiresAt - REFRESH_MARGIN_MS)
      return session;
    return this.renew(id, session);
  }

  /** Session telle qu'elle est stockee, sans tentative de renouvellement. */
  async peek(id: string): Promise<StoredSession | null> {
    const raw = await this.redis.get(`${SESSION_PREFIX}${id}`);
    if (!raw) return null;

    const parsed = StoredSession.safeParse(safeJsonParse(raw));
    if (!parsed.success) {
      await this.destroy(id);
      return null;
    }
    return parsed.data;
  }

  async destroy(id: string): Promise<void> {
    await this.redis.del(`${SESSION_PREFIX}${id}`);
  }

  /**
   * Renouvelle les jetons sous verrou.
   *
   * Le realm est en rotation stricte : un refresh token ne sert qu'une fois.
   * Deux requetes simultanees qui renouvelleraient chacune de leur cote
   * feraient invalider la session entiere par Keycloak, qui lit le second
   * appel comme un rejeu.
   */
  private async renew(
    id: string,
    current: StoredSession,
  ): Promise<StoredSession | null> {
    const lockKey = `${LOCK_PREFIX}${id}`;
    const owner = randomToken();
    const acquired = await this.redis.set(
      lockKey,
      owner,
      'PX',
      LOCK_TTL_MS,
      'NX',
    );

    if (!acquired) {
      return this.waitForRenewal(id, current);
    }

    try {
      const tokens = await this.oidc.refresh(current.refreshToken);
      const renewed: StoredSession = {
        ...current,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        accessExpiresAt: Date.now() + tokens.expires_in * 1000,
        refreshExpiresAt: refreshDeadline(tokens),
      };
      await this.write(id, renewed);
      return renewed;
    } catch (error: unknown) {
      // Refus de Keycloak : session revoquee, expiree, ou rejeu detecte.
      this.logger.warn(
        `renouvellement refuse pour une session : ${String(error)}`,
      );
      await this.destroy(id);
      return null;
    } finally {
      await this.redis.eval(RELEASE_LOCK, 1, lockKey, owner);
    }
  }

  /** Attend le renouvellement mene par une requete concurrente. */
  private async waitForRenewal(
    id: string,
    current: StoredSession,
  ): Promise<StoredSession | null> {
    for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt += 1) {
      await delay(LOCK_WAIT_MS);
      const session = await this.peek(id);
      if (!session) return null;
      if (session.accessToken !== current.accessToken) return session;
    }

    this.logger.warn('attente du renouvellement expiree');
    return null;
  }

  private async write(id: string, session: StoredSession): Promise<void> {
    // La cle expire avec le refresh token : passe cette date, la session ne
    // peut plus etre renouvelee de toute facon.
    const ttlSeconds = Math.max(
      1,
      Math.ceil((session.refreshExpiresAt - Date.now()) / 1000),
    );
    await this.redis.set(
      `${SESSION_PREFIX}${id}`,
      JSON.stringify(session),
      'EX',
      ttlSeconds,
    );
  }
}

function toStoredSession(
  tokens: TokenSet,
  identity: VerifiedIdentity,
): StoredSession {
  return {
    sub: identity.sub,
    email: identity.email,
    emailVerified: identity.emailVerified,
    roles: identity.roles,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    accessExpiresAt: Date.now() + tokens.expires_in * 1000,
    refreshExpiresAt: refreshDeadline(tokens),
  };
}

/**
 * Duree de vie du refresh token. Keycloak omet refresh_expires_in quand le
 * jeton est hors ligne ou sans expiration propre : on retombe alors sur la
 * duree maximale de session SSO du realm, soit dix heures.
 *
 * Elle borne a la fois la cle Redis et l'age maximal du cookie de session.
 */
export function refreshLifetimeSeconds(tokens: TokenSet): number {
  return tokens.refresh_expires_in && tokens.refresh_expires_in > 0
    ? tokens.refresh_expires_in
    : 36_000;
}

function refreshDeadline(tokens: TokenSet): number {
  return Date.now() + refreshLifetimeSeconds(tokens) * 1000;
}

/** 256 bits d'entropie : suffisant pour un identifiant de session opaque. */
function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Comparaison a duree constante de deux valeurs opaques. */
export function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
