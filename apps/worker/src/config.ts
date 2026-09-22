import { z } from 'zod';
import { LLM_MODELS, OPENROUTER_ONLY_BODY_KEYS } from '@odyssai/llm';

/*
  Configuration du worker, validee au demarrage. Contrairement a l'api, le
  modele de narration y est exige : un worker sans modele ne sait rien faire,
  et demarrer pour echouer a chaque travail ne rend service a personne.
*/
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    REDIS_URL: z.url(),
    POSTGRES_URL: z.string().min(1),

    LLM_NARRATOR_PROVIDER: z.enum(['openrouter', 'openai']).default('openrouter'),
    LLM_NARRATOR_EXTRA_BODY: z.string().default('{}'),

    /*
      Servent au journal d'usage quand le fournisseur ne rend pas le cout.
      Zero par defaut : une ligne sans cout vaut mieux qu'un cout invente.
    */
    LLM_NARRATOR_PRICE_INPUT_USD_PER_MTOK: z.coerce.number().nonnegative().default(0),
    LLM_NARRATOR_PRICE_OUTPUT_USD_PER_MTOK: z.coerce.number().nonnegative().default(0),

    OPENROUTER_API_KEY: z.string().default(''),
    OPENAI_API_KEY: z.string().default(''),

    /*
      Un monde a la fois par worker. Chaque generation fait sept appels et
      dure des minutes : en faire tourner plusieurs de front sur une petite
      machine allongerait les deux sans rien gagner.
    */
    WORKER_CONCURRENCY: z.coerce.number().int().positive().max(8).default(1),
  })
  .superRefine((env, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    // Les controles de prefixe attrapent une cle collee dans la mauvaise
    // variable, qui partirait sinon chez le mauvais fournisseur.
    if (env.LLM_NARRATOR_PROVIDER === 'openrouter') {
      if (!env.OPENROUTER_API_KEY) {
        fail('OPENROUTER_API_KEY', 'requise avec LLM_NARRATOR_PROVIDER=openrouter');
      } else if (!env.OPENROUTER_API_KEY.startsWith('sk-or-')) {
        fail('OPENROUTER_API_KEY', 'une cle OpenRouter commence par sk-or-');
      }
    }

    if (env.LLM_NARRATOR_PROVIDER === 'openai') {
      if (!env.OPENAI_API_KEY) {
        fail('OPENAI_API_KEY', 'requise avec LLM_NARRATOR_PROVIDER=openai');
      } else if (
        !env.OPENAI_API_KEY.startsWith('sk-') ||
        env.OPENAI_API_KEY.startsWith('sk-or-')
      ) {
        fail('OPENAI_API_KEY', 'une cle OpenAI commence par sk- et non sk-or-');
      }
    }

    const extraBody = parseExtraBody(env.LLM_NARRATOR_EXTRA_BODY);
    if (!extraBody.ok) {
      fail('LLM_NARRATOR_EXTRA_BODY', extraBody.message);
      return;
    }

    if (env.LLM_NARRATOR_PROVIDER === 'openai') {
      const rejected = OPENROUTER_ONLY_BODY_KEYS.filter(
        (key) => key in extraBody.value,
      );
      if (rejected.length > 0) {
        fail(
          'LLM_NARRATOR_EXTRA_BODY',
          `cles propres a OpenRouter refusees avec le fournisseur openai : ${rejected.join(', ')}`,
        );
      }
    }
  });

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

export type WorkerConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration du worker invalide, voir .env.example :\n${details}`);
  }

  const env = parsed.data;
  const extraBody = parseExtraBody(env.LLM_NARRATOR_EXTRA_BODY);

  return {
    nodeEnv: env.NODE_ENV,
    redisUrl: env.REDIS_URL,
    postgresUrl: env.POSTGRES_URL,
    concurrency: env.WORKER_CONCURRENCY,
    provider: env.LLM_NARRATOR_PROVIDER,
    // Jamais journalisee : elle ne sort que vers createLlmClient.
    apiKey:
      env.LLM_NARRATOR_PROVIDER === 'openrouter'
        ? env.OPENROUTER_API_KEY
        : env.OPENAI_API_KEY,
    // Un modele par role, du registre code en dur de `packages/llm`.
    // `superRefine` a deja refuse un corps illisible : ici il est toujours lu.
    models: {
      generation: { ...LLM_MODELS.generation, extraBody: extraBody.ok ? extraBody.value : {} },
      abstraction: { ...LLM_MODELS.abstraction, extraBody: extraBody.ok ? extraBody.value : {} },
    },
    // Sert au journal d'usage quand le fournisseur ne rend pas le cout.
    prices: {
      inputUsdPerMTok: env.LLM_NARRATOR_PRICE_INPUT_USD_PER_MTOK,
      outputUsdPerMTok: env.LLM_NARRATOR_PRICE_OUTPUT_USD_PER_MTOK,
    },
  };
}
