import { beforeEach, describe, expect, it } from 'vitest';
import { GuideConfig } from './guide-config.js';

const BASE: Record<string, string> = {
  NODE_ENV: 'test',
  LLM_GUIDE_PROVIDER: 'openrouter',
  LLM_GUIDE_MODEL: 'modele/de-test',
  LLM_GUIDE_EXTRA_BODY: '{}',
  LLM_GUIDE_PRICE_INPUT_USD_PER_MTOK: '0.20',
  LLM_GUIDE_PRICE_OUTPUT_USD_PER_MTOK: '1.20',
  OPENROUTER_API_KEY: 'sk-or-factice',
  OPENAI_API_KEY: 'sk-factice',
  GUIDE_IP_HASH_SECRET: 'secret-de-test-assez-long',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  LANGSMITH_TRACING: 'false',
};

function make(overrides: Record<string, string | undefined> = {}): GuideConfig {
  const previous = process.env;
  process.env = { ...previous, ...BASE, ...overrides } as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
  }
  try {
    return new GuideConfig();
  } finally {
    process.env = previous;
  }
}

describe('GuideConfig', () => {
  let original: NodeJS.ProcessEnv;

  beforeEach(() => {
    original = process.env;
    return () => {
      process.env = original;
    };
  });

  describe('cles de fournisseur', () => {
    it('accepte une configuration complete', () => {
      expect(make().provider).toBe('openrouter');
    });

    it('refuse une cle OpenAI collee dans OPENROUTER_API_KEY', () => {
      expect(() => make({ OPENROUTER_API_KEY: 'sk-une-cle-openai' })).toThrow(
        /sk-or-/,
      );
    });

    it('refuse une cle OpenRouter collee dans OPENAI_API_KEY', () => {
      expect(() =>
        make({ LLM_GUIDE_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-or-factice' }),
      ).toThrow(/sk- et non sk-or-/);
    });

    it('ignore la cle de l autre fournisseur', () => {
      expect(() => make({ OPENAI_API_KEY: 'valeur-absurde' })).not.toThrow();
    });
  });

  describe('extraBody', () => {
    it('refuse un JSON invalide', () => {
      expect(() => make({ LLM_GUIDE_EXTRA_BODY: '{pas du json' })).toThrow(
        /JSON invalide/,
      );
    });

    it('refuse les cles propres a OpenRouter avec le fournisseur openai', () => {
      expect(() =>
        make({
          LLM_GUIDE_PROVIDER: 'openai',
          LLM_GUIDE_EXTRA_BODY: '{"models":["x"],"reasoning":{"effort":"none"}}',
        }),
      ).toThrow(/models, reasoning/);
    });

    it('les accepte avec openrouter', () => {
      const config = make({
        LLM_GUIDE_EXTRA_BODY: '{"models":["x"],"provider":{"data_collection":"deny"}}',
      });
      expect(config.extraBody).toEqual({
        models: ['x'],
        provider: { data_collection: 'deny' },
      });
    });
  });

  describe('tracing', () => {
    it('refuse un tracing actif sans cle', () => {
      expect(() =>
        make({ LANGSMITH_TRACING: 'true', LANGSMITH_API_KEY: '' }),
      ).toThrow(/LANGSMITH_API_KEY/);
    });

    it('accepte un tracing actif complet', () => {
      const config = make({
        LANGSMITH_TRACING: 'true',
        LANGSMITH_API_KEY: 'ls-factice',
        LANGSMITH_PROJECT: 'Odyssai-Test',
      });
      expect(config.tracing).toMatchObject({
        enabled: true,
        project: 'Odyssai-Test',
      });
    });
  });

  describe('Turnstile et proxy', () => {
    it('refuse une cle de test en production', () => {
      expect(() =>
        make({ NODE_ENV: 'production', TURNSTILE_SECRET_KEY: '1x000000' }),
      ).toThrow(/cle de test Cloudflare/);
    });

    it('accepte une vraie cle en production', () => {
      expect(() =>
        make({ NODE_ENV: 'production', TURNSTILE_SECRET_KEY: '0xVraieCle' }),
      ).not.toThrow();
    });

    it('lit TRUST_PROXY sous ses trois formes', () => {
      expect(make().trustProxy).toBe(false);
      expect(make({ TRUST_PROXY: '2' }).trustProxy).toBe(2);
      expect(make({ TRUST_PROXY: '10.0.0.1, 10.0.0.2' }).trustProxy).toEqual([
        '10.0.0.1',
        '10.0.0.2',
      ]);
    });
  });
});
