import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { OPENROUTER_ONLY_BODY_KEYS } from '@odyssai/llm';

/**
 * Le modele de narration se choisit par evaluation, pas par reputation : il n'y
 * a donc pas de defaut ici. `LLM_NARRATOR_CANDIDATES` porte les modeles a
 * comparer, `LLM_NARRATOR_MODEL` celui qui a gagne.
 *
 * Vide, la configuration n'empeche pas l'api de demarrer : la narration
 * n'existe encore ni dans une route ni dans un worker, et faire tomber le
 * bootstrap pour une variable qu'aucun chemin de requete ne lit ferait echouer
 * loin de la cause. Ceux qui en ont besoin le disent eux-memes.
 */
const EnvSchema = z
  .object({
    LLM_NARRATOR_PROVIDER: z.enum(['openrouter', 'openai']).default('openrouter'),
    LLM_NARRATOR_MODEL: z.string().default(''),
    LLM_NARRATOR_CANDIDATES: z.string().default(''),
    LLM_NARRATOR_EXTRA_BODY: z.string().default('{}'),
    LLM_NARRATOR_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.6),
    LLM_NARRATOR_MAX_OUTPUT_TOKENS: z.coerce
      .number()
      .int()
      .positive()
      .default(900),
    LLM_NARRATOR_PRICE_INPUT_USD_PER_MTOK: z.coerce
      .number()
      .nonnegative()
      .default(0),
    LLM_NARRATOR_PRICE_OUTPUT_USD_PER_MTOK: z.coerce
      .number()
      .nonnegative()
      .default(0),

    /**
     * Bornes d'un joueur authentifie. Le guide se defend d'un visiteur anonyme
     * par cinq couches ; ici l'identite suffit, il ne reste qu'a empecher qu'un
     * compte a lui seul epuise le budget.
     */
    TURN_RATE_PER_HOUR: z.coerce.number().int().positive().default(60),
    TURN_RATE_PER_DAY: z.coerce.number().int().positive().default(300),

    /**
     * Le classificateur de moderation. Vide, seule la couche lexicale tourne :
     * elle arrete l'evidence, pas le reste.
     */
    MODERATION_MODEL: z.string().default('qwen/qwen3-8b'),
    MODERATION_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(40),

    /** Modele d'embeddings, pour la memoire longue du meneur. */
    LLM_EMBED_MODEL: z.string().default('openai/text-embedding-3-small'),
    LLM_EMBED_DIMENSIONS: z.coerce.number().int().positive().default(1536),

    OPENROUTER_API_KEY: z.string().default(''),
    OPENAI_API_KEY: z.string().default(''),
  })
  .superRefine((env, ctx) => {
    const fail = (path: string, message: string) => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };

    const extraBody = parseExtraBody(env.LLM_NARRATOR_EXTRA_BODY);
    if (!extraBody.ok) {
      fail('LLM_NARRATOR_EXTRA_BODY', extraBody.message);
      return;
    }

    if (env.LLM_NARRATOR_PROVIDER === 'openai') {
      const rejected = OPENROUTER_ONLY_BODY_KEYS.filter(
        (key) => key in extraBody.value,
      );
      // L'API d'OpenAI rejette les arguments qu'elle ne connait pas.
      if (rejected.length > 0) {
        fail(
          'LLM_NARRATOR_EXTRA_BODY',
          `cles propres a OpenRouter refusees avec le fournisseur openai : ${rejected.join(', ')}`,
        );
      }
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

@Injectable()
export class NarratorConfig {
  private readonly env: Env;
  readonly extraBody: Record<string, unknown>;

  constructor() {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `  ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
        .join('\n');
      throw new Error(
        `Configuration du narrateur invalide, voir .env.example :\n${details}`,
      );
    }

    this.env = parsed.data;
    const extraBody = parseExtraBody(this.env.LLM_NARRATOR_EXTRA_BODY);
    this.extraBody = extraBody.ok ? extraBody.value : {};
  }

  /** Faux tant qu'aucun modele n'a ete retenu par l'evaluation. */
  get configured(): boolean {
    return this.env.LLM_NARRATOR_MODEL.length > 0;
  }

  get provider(): 'openrouter' | 'openai' {
    return this.env.LLM_NARRATOR_PROVIDER;
  }

  /** Jamais journalisee ni renvoyee : elle ne sort que vers createLlmClient. */
  get apiKey(): string {
    return this.provider === 'openrouter'
      ? this.env.OPENROUTER_API_KEY
      : this.env.OPENAI_API_KEY;
  }

  get model() {
    return {
      model: this.env.LLM_NARRATOR_MODEL,
      temperature: this.env.LLM_NARRATOR_TEMPERATURE,
      maxOutputTokens: this.env.LLM_NARRATOR_MAX_OUTPUT_TOKENS,
      extraBody: this.extraBody,
    };
  }

  /** Les modeles a comparer. Lus par le script d'evaluation seul. */
  get turnLimits() {
    return {
      perHour: this.env.TURN_RATE_PER_HOUR,
      perDay: this.env.TURN_RATE_PER_DAY,
    };
  }

  get moderation() {
    return {
      enabled: this.env.MODERATION_MODEL.length > 0,
      model: this.env.MODERATION_MODEL,
      // Un verdict n'a pas a etre cree : zero pour qu'il soit reproductible.
      temperature: 0,
      maxOutputTokens: this.env.MODERATION_MAX_OUTPUT_TOKENS,
      /**
       * Le meme corps que la narration, et non une variable de plus : c'est le
       * meme fournisseur et ce sont les memes exigences. Sans lui, le
       * classificateur facturait 140 a 178 jetons de raisonnement au tarif de
       * sortie pour rendre un verdict d'une ligne, soit les deux tiers de ce
       * que coute une moderation, et le texte du joueur partait sans
       * `data_collection: deny`.
       */
      extraBody: this.extraBody,
    };
  }

  get embed() {
    return {
      model: this.env.LLM_EMBED_MODEL,
      dimensions: this.env.LLM_EMBED_DIMENSIONS,
    };
  }

  get candidates(): string[] {
    return this.env.LLM_NARRATOR_CANDIDATES.split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  get prices() {
    return {
      inputUsdPerMTok: this.env.LLM_NARRATOR_PRICE_INPUT_USD_PER_MTOK,
      outputUsdPerMTok: this.env.LLM_NARRATOR_PRICE_OUTPUT_USD_PER_MTOK,
    };
  }
}
