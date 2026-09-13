import type { CookieOptions, Request, Response } from 'express';
import { AppConfig } from '../../config/app-config.js';

const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3001',
  API_BASE_URL: 'http://localhost:3001',
  WEB_BASE_URL: 'http://localhost:3000',
  KEYCLOAK_ISSUER: 'https://sso.example.test/realms/odyssai-test',
  KEYCLOAK_CLIENT_ID: 'odyssai-api',
  KEYCLOAK_CLIENT_SECRET: 'secret-de-test',
  REDIS_URL: 'redis://127.0.0.1:6379/0',
};

/** AppConfig reel, alimente par un environnement de test. */
export function makeConfig(overrides: Record<string, string> = {}): AppConfig {
  const previous = process.env;
  process.env = { ...previous, ...BASE_ENV, ...overrides };
  try {
    return new AppConfig();
  } finally {
    process.env = previous;
  }
}

export interface ResponseDouble {
  response: Response;
  cookies: Map<string, { value: string; options: CookieOptions }>;
  cleared: string[];
}

/** Reponse Express reduite a ce que le controleur utilise. */
export function makeResponse(): ResponseDouble {
  const cookies = new Map<string, { value: string; options: CookieOptions }>();
  const cleared: string[] = [];

  const response = {
    cookie(name: string, value: string, options: CookieOptions) {
      cookies.set(name, { value, options });
      return response;
    },
    clearCookie(name: string) {
      cookies.delete(name);
      cleared.push(name);
      return response;
    },
  };

  return { response: response as unknown as Response, cookies, cleared };
}

export function makeRequest(cookies: Record<string, string> = {}): Request {
  return { cookies } as unknown as Request;
}

interface Entry {
  value: string;
  expiresAt: number;
}

/**
 * Redis reduit aux commandes employees par SessionService : get, set avec
 * EX/PX/NX, getdel, del et le script de liberation de verrou.
 */
export class FakeRedis {
  private readonly store = new Map<string, Entry>();

  /**
   * Lecture synchrone interne. Les commandes publiques s'appuient dessus pour
   * rester atomiques : un await entre le test de presence et l'ecriture
   * laisserait deux appels concurrents obtenir le meme verrou NX, ce qu'un
   * vrai Redis ne fait jamais.
   */
  private live(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key);
  }

  async set(
    key: string,
    value: string,
    ...args: unknown[]
  ): Promise<'OK' | null> {
    const flags = args.map(String);
    const unitIndex = flags.findIndex((flag) => flag === 'EX' || flag === 'PX');
    const ttlRaw = unitIndex >= 0 ? Number(flags[unitIndex + 1]) : 0;
    const ttlMs =
      unitIndex >= 0 && flags[unitIndex] === 'EX' ? ttlRaw * 1000 : ttlRaw;

    if (flags.includes('NX') && this.live(key) !== null) return null;

    this.store.set(key, {
      value,
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : Number.POSITIVE_INFINITY,
    });
    return 'OK';
  }

  async getdel(key: string): Promise<string | null> {
    const value = this.live(key);
    this.store.delete(key);
    return value;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  /** Rejoue le script de liberation : supprime seulement si la valeur colle. */
  async eval(
    _script: string,
    _numKeys: number,
    key: string,
    owner: string,
  ): Promise<number> {
    if (this.live(key) !== owner) return 0;
    this.store.delete(key);
    return 1;
  }

  /** Appele par le crochet d'arret de RedisModule. */
  async quit(): Promise<'OK'> {
    this.store.clear();
    return 'OK';
  }

  size(): number {
    return this.store.size;
  }
}
