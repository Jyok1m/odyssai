import { beforeEach, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { GuideConfig } from '../config/guide-config.js';
import { GuideBudgetService } from './guide-budget.service.js';
import { GuideLimitsService, rateLimitKey } from './guide-limits.service.js';
import { GuideFakeRedis } from './testing/doubles.js';

const SECRET = 'secret-de-test-assez-long';

const BASE: Record<string, string> = {
  NODE_ENV: 'test',
  LLM_GUIDE_MODEL: 'modele/de-test',
  LLM_GUIDE_MAX_OUTPUT_TOKENS: '350',
  LLM_GUIDE_PRICE_INPUT_USD_PER_MTOK: '0.20',
  LLM_GUIDE_PRICE_OUTPUT_USD_PER_MTOK: '1.20',
  OPENROUTER_API_KEY: 'sk-or-factice',
  GUIDE_IP_HASH_SECRET: SECRET,
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  LANGSMITH_TRACING: 'false',
};

function makeConfig(overrides: Record<string, string> = {}): GuideConfig {
  const previous = process.env;
  process.env = { ...previous, ...BASE, ...overrides } as NodeJS.ProcessEnv;
  try {
    return new GuideConfig();
  } finally {
    process.env = previous;
  }
}

describe('rateLimitKey', () => {
  it('ne laisse aucune adresse en clair', () => {
    const key = rateLimitKey('203.0.113.7', SECRET);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain('203');
  });

  it('distingue deux adresses IPv4', () => {
    expect(rateLimitKey('203.0.113.7', SECRET)).not.toBe(
      rateLimitKey('203.0.113.8', SECRET),
    );
  });

  it('confond deux adresses du meme /64 en IPv6', () => {
    // Un abonne recoit un /64 entier : limiter l'adresse complete ne
    // limiterait rien du tout.
    expect(rateLimitKey('2001:db8:1:2::1', SECRET)).toBe(
      rateLimitKey('2001:db8:1:2:ffff:ffff:ffff:ffff', SECRET),
    );
  });

  it('separe deux /64 differents', () => {
    expect(rateLimitKey('2001:db8:1:2::1', SECRET)).not.toBe(
      rateLimitKey('2001:db8:1:3::1', SECRET),
    );
  });

  it('ramene une IPv4 mappee a sa forme d origine', () => {
    expect(rateLimitKey('::ffff:203.0.113.7', SECRET)).toBe(
      rateLimitKey('203.0.113.7', SECRET),
    );
  });

  it('change avec le secret', () => {
    expect(rateLimitKey('203.0.113.7', SECRET)).not.toBe(
      rateLimitKey('203.0.113.7', 'un-autre-secret-assez-long'),
    );
  });
});

describe('GuideLimitsService', () => {
  let redis: GuideFakeRedis;
  let limits: GuideLimitsService;

  beforeEach(() => {
    redis = new GuideFakeRedis();
    limits = new GuideLimitsService(
      redis as unknown as Redis,
      makeConfig({ GUIDE_RATE_PER_HOUR: '2', GUIDE_RATE_PER_DAY: '3', GUIDE_MAX_CONCURRENT: '2' }),
    );
  });

  it('laisse passer jusqu a la limite horaire puis refuse', async () => {
    const key = limits.key('203.0.113.7');

    expect((await limits.consume(key)).allowed).toBe(true);
    expect((await limits.consume(key)).allowed).toBe(true);

    const refus = await limits.consume(key);
    expect(refus.allowed).toBe(false);
    expect(refus.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('separe deux adresses', async () => {
    const a = limits.key('203.0.113.7');
    const b = limits.key('203.0.113.8');

    await limits.consume(a);
    await limits.consume(a);
    expect((await limits.consume(a)).allowed).toBe(false);
    expect((await limits.consume(b)).allowed).toBe(true);
  });

  it('refuse un creneau de trop et le rend apres liberation', async () => {
    expect(await limits.acquireSlot('un')).toBe(true);
    expect(await limits.acquireSlot('deux')).toBe(true);
    expect(await limits.acquireSlot('trois')).toBe(false);

    await limits.releaseSlot('un');
    expect(await limits.acquireSlot('trois')).toBe(true);
  });

  it('purge les creneaux abandonnes par un processus disparu', async () => {
    const vieux = Date.now() - 200_000;
    expect(await limits.acquireSlot('fantome', vieux)).toBe(true);
    expect(await limits.acquireSlot('un')).toBe(true);
    expect(await limits.acquireSlot('deux')).toBe(true);
    // Le creneau fantome a ete purge par anciennete, sinon il en resterait un.
    expect(redis.inflight()).toBe(2);
  });
});

describe('GuideBudgetService', () => {
  let redis: GuideFakeRedis;
  let budget: GuideBudgetService;

  beforeEach(() => {
    redis = new GuideFakeRedis();
    budget = new GuideBudgetService(
      redis as unknown as Redis,
      makeConfig({ GUIDE_DAILY_BUDGET_USD: '0.01' }),
    );
  });

  it('estime de facon pessimiste, trois caracteres par token', () => {
    // 3000 caracteres donnent 1000 tokens d'entree a 0,20 $ le million, plus
    // 350 tokens de sortie a 1,20 $ le million.
    expect(budget.estimate(3_000)).toBeCloseTo((1_000 * 0.2 + 350 * 1.2) / 1e6, 10);
  });

  it('refuse une reservation qui depasse le plafond', async () => {
    expect(await budget.reserve('un', 0.009)).toBe(true);
    expect(await budget.reserve('deux', 0.009)).toBe(false);
  });

  it('libere la reservation au reglement et retient le cout reel', async () => {
    await budget.reserve('un', 0.009);
    await budget.settle('un', {
      inputTokens: 100,
      outputTokens: 10,
      costUsd: 0.0001,
    });

    // La reservation rendue, il reste de la place pour une seconde question.
    expect(await budget.reserve('deux', 0.009)).toBe(true);
  });

  it('retient le montant reserve quand aucun usage ne remonte', async () => {
    await budget.reserve('un', 0.009);
    await budget.settle('un', undefined);

    // Le reserve a ete transforme en depense : plus de place.
    expect(await budget.reserve('deux', 0.009)).toBe(false);
  });

  it('prefere le cout du fournisseur au calcul par tokens', () => {
    expect(
      budget.realCost({ inputTokens: 1_000, outputTokens: 100, costUsd: 0.5 }),
    ).toBe(0.5);
  });

  it('compte les tokens de raisonnement dans la sortie', () => {
    const sans = budget.realCost({ inputTokens: 0, outputTokens: 100 });
    const avec = budget.realCost({
      inputTokens: 0,
      outputTokens: 100,
      reasoningTokens: 100,
    });
    expect(avec).toBeCloseTo(sans! * 2, 12);
  });
});
