import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { OPENROUTER_ONLY_BODY_KEYS } from '@odyssai/llm';

/*
  Cles de test Cloudflare. Elles acceptent n'importe quel jeton, ce qui est
  exactement ce qu'il faut en developpement et exactement ce qu'il ne faut pas
  en production.
*/
const TURNSTILE_TEST_KEY_PREFIXES = ['1x', '2x', '3x'];

/*
  Le defaut porte sur la chaine, avant la transformation : Zod 4 attend la
  valeur de sortie si l'ordre est inverse.
*/
const boolish = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');

const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),

    OPENROUTER_API_KEY: z.string().default(''),
    OPENAI_API_KEY: z.string().default(''),

    LANGSMITH_TRACING: boolish('false'),
    LANGSMITH_ENDPOINT: z.url().default('https://eu.api.smith.langchain.com'),
    LANGSMITH_API_KEY: z.string().default(''),
    LANGSMITH_PROJECT: z.string().default('Odyssai-Dev'),
    LANGSMITH_WORKSPACE_ID: z.string().optional(),

    LLM_GUIDE_PROVIDER: z.enum(['openrouter', 'openai']).default('openrouter'),
    LLM_GUIDE_MODEL: z.string().min(1),
    LLM_GUIDE_EXTRA_BODY: z.string().default('{}'),
    LLM_GUIDE_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.3),
    LLM_GUIDE_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(350),
    LLM_GUIDE_PRICE_INPUT_USD_PER_MTOK: z.coerce.number().nonnegative(),
    LLM_GUIDE_PRICE_OUTPUT_USD_PER_MTOK: z.coerce.number().nonnegative(),

    GUIDE_ENABLED: boolish('true'),
    GUIDE_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(1),
    GUIDE_RATE_PER_HOUR: z.coerce.number().int().positive().default(10),
    GUIDE_RATE_PER_DAY: z.coerce.number().int().positive().default(30),
    GUIDE_MAX_CONCURRENT: z.coerce.number().int().positive().default(5),
    GUIDE_PASS_QUESTIONS: z.coerce.number().int().positive().default(10),
    GUIDE_PASS_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
    GUIDE_IP_HASH_SECRET: z.string().min(16),
    GUIDE_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    GUIDE_TRACE_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
    GUIDE_TRACE_HIDE_IO: boolish('false'),

    TURNSTILE_SECRET_KEY: z.string().min(1),
    TRUST_PROXY: z.string().default('false'),
  })
  .superRefine((env, ctx) => {
    const fail = (path: string, message: string) => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };

    // Les controles de prefixe attrapent une cle collee dans la mauvaise
    // variable, qui partirait sinon chez le mauvais fournisseur.
    if (env.LLM_GUIDE_PROVIDER === 'openrouter') {
      if (!env.OPENROUTER_API_KEY) {
        fail('OPENROUTER_API_KEY', 'requise avec LLM_GUIDE_PROVIDER=openrouter');
      } else if (!env.OPENROUTER_API_KEY.startsWith('sk-or-')) {
        fail('OPENROUTER_API_KEY', 'une cle OpenRouter commence par sk-or-');
      }
    }

    if (env.LLM_GUIDE_PROVIDER === 'openai') {
      if (!env.OPENAI_API_KEY) {
        fail('OPENAI_API_KEY', 'requise avec LLM_GUIDE_PROVIDER=openai');
      } else if (
        !env.OPENAI_API_KEY.startsWith('sk-') ||
        env.OPENAI_API_KEY.startsWith('sk-or-')
      ) {
        fail('OPENAI_API_KEY', 'une cle OpenAI commence par sk- et non sk-or-');
      }
    }

    const extraBody = parseExtraBody(env.LLM_GUIDE_EXTRA_BODY);
    if (!extraBody.ok) {
      fail('LLM_GUIDE_EXTRA_BODY', extraBody.message);
    } else if (env.LLM_GUIDE_PROVIDER === 'openai') {
      const rejected = OPENROUTER_ONLY_BODY_KEYS.filter(
        (key) => key in extraBody.value,
      );
      // L'API d'OpenAI rejette les arguments qu'elle ne connait pas.
      if (rejected.length > 0) {
        fail(
          'LLM_GUIDE_EXTRA_BODY',
          `cles propres a OpenRouter refusees avec le fournisseur openai : ${rejected.join(', ')}`,
        );
      }
    }

    if (env.LANGSMITH_TRACING) {
      if (!env.LANGSMITH_API_KEY) {
        fail('LANGSMITH_API_KEY', 'requise avec LANGSMITH_TRACING=true');
      }
      if (!env.LANGSMITH_PROJECT) {
        fail('LANGSMITH_PROJECT', 'requis avec LANGSMITH_TRACING=true');
      }
    }

    if (
      env.NODE_ENV === 'production' &&
      TURNSTILE_TEST_KEY_PREFIXES.some((prefix) =>
        env.TURNSTILE_SECRET_KEY.startsWith(prefix),
      )
    ) {
      fail(
        'TURNSTILE_SECRET_KEY',
        'cle de test Cloudflare interdite en production : elle accepte tout',
      );
    }
  });

type Env = z.infer<typeof EnvSchema>;

function parseExtraBody(
  raw: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: 'objet JSON attendu' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, message: 'JSON invalide' };
  }
}

/*
  `trust proxy` d'Express : false, un nombre de proxys, ou une liste d'adresses.
  Mal regle, req.ip vaut l'adresse du proxy et la limite par IP devient une
  limite globale.
*/
function parseTrustProxy(raw: string): boolean | number | string[] {
  if (raw === 'false' || raw === '') return false;
  if (raw === 'true') return true;

  const asNumber = Number(raw);
  if (Number.isInteger(asNumber) && asNumber >= 0) return asNumber;

  return raw.split(',').map((part) => part.trim()).filter(Boolean);
}

/*
  Configuration du guide, validee au demarrage comme AppConfig. Une classe a
  part plutot que vingt-cinq variables de plus dans AppConfig : le bootstrap
  echoue de la meme facon, la lecture reste possible.
*/
@Injectable()
export class GuideConfig {
  private readonly logger = new Logger(GuideConfig.name);
  private readonly env: Env;
  readonly extraBody: Record<string, unknown>;
  readonly trustProxy: boolean | number | string[];

  constructor() {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `  ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
        .join('\n');
      throw new Error(
        `Configuration du guide invalide, voir .env.example :\n${details}`,
      );
    }

    this.env = parsed.data;
    const extraBody = parseExtraBody(this.env.LLM_GUIDE_EXTRA_BODY);
    this.extraBody = extraBody.ok ? extraBody.value : {};
    this.trustProxy = parseTrustProxy(this.env.TRUST_PROXY);

    if (
      this.env.NODE_ENV === 'production' &&
      this.env.LANGSMITH_PROJECT.includes('Dev')
    ) {
      this.logger.warn(
        `LANGSMITH_PROJECT vaut ${this.env.LANGSMITH_PROJECT} en production : les traces iront dans un projet de developpement`,
      );
    }
  }

  get enabled(): boolean {
    return this.env.GUIDE_ENABLED;
  }

  get provider(): 'openrouter' | 'openai' {
    return this.env.LLM_GUIDE_PROVIDER;
  }

  // Jamais journalisee ni renvoyee : elle ne sort que vers createLlmClient.
  get apiKey(): string {
    return this.provider === 'openrouter'
      ? this.env.OPENROUTER_API_KEY
      : this.env.OPENAI_API_KEY;
  }

  get model() {
    return {
      model: this.env.LLM_GUIDE_MODEL,
      temperature: this.env.LLM_GUIDE_TEMPERATURE,
      maxOutputTokens: this.env.LLM_GUIDE_MAX_OUTPUT_TOKENS,
      extraBody: this.extraBody,
    };
  }

  get prices() {
    return {
      inputUsdPerMTok: this.env.LLM_GUIDE_PRICE_INPUT_USD_PER_MTOK,
      outputUsdPerMTok: this.env.LLM_GUIDE_PRICE_OUTPUT_USD_PER_MTOK,
    };
  }

  get tracing() {
    return {
      enabled: this.env.LANGSMITH_TRACING,
      endpoint: this.env.LANGSMITH_ENDPOINT,
      apiKey: this.env.LANGSMITH_API_KEY,
      project: this.env.LANGSMITH_PROJECT,
      workspaceId: this.env.LANGSMITH_WORKSPACE_ID,
      sampleRate: this.env.GUIDE_TRACE_SAMPLE_RATE,
      hideIo: this.env.GUIDE_TRACE_HIDE_IO,
    };
  }

  get limits() {
    return {
      perHour: this.env.GUIDE_RATE_PER_HOUR,
      perDay: this.env.GUIDE_RATE_PER_DAY,
      maxConcurrent: this.env.GUIDE_MAX_CONCURRENT,
      ipHashSecret: this.env.GUIDE_IP_HASH_SECRET,
    };
  }

  get pass() {
    return {
      questions: this.env.GUIDE_PASS_QUESTIONS,
      ttlSeconds: this.env.GUIDE_PASS_TTL_SECONDS,
      turnstileSecret: this.env.TURNSTILE_SECRET_KEY,
    };
  }

  get dailyBudgetUsd(): number {
    return this.env.GUIDE_DAILY_BUDGET_USD;
  }

  get logRetentionDays(): number {
    return this.env.GUIDE_LOG_RETENTION_DAYS;
  }
}
