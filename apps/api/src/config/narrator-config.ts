import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { LLM_MODELS, OPENROUTER_ONLY_BODY_KEYS, type LlmRole } from '@odyssai/llm';

/*
  Les modeles vivent dans `packages/llm/src/models.ts`, un par role et en
  code. Ici ne restent que ce qui depend de la machine : le fournisseur, ses
  cles, le corps supplementaire, les prix de repli, et les candidats a
  comparer par `eval:narration` avant de decider la-bas.
*/
const EnvSchema = z
  .object({
    LLM_NARRATOR_PROVIDER: z.enum(['openrouter', 'openai']).default('openrouter'),
    LLM_NARRATOR_CANDIDATES: z.string().default(''),
    LLM_NARRATOR_EXTRA_BODY: z.string().default('{}'),
    LLM_NARRATOR_PRICE_INPUT_USD_PER_MTOK: z.coerce
      .number()
      .nonnegative()
      .default(0),
    LLM_NARRATOR_PRICE_OUTPUT_USD_PER_MTOK: z.coerce
      .number()
      .nonnegative()
      .default(0),

    /*
      Bornes d'un joueur authentifie. Le guide se defend d'un visiteur anonyme
      par cinq couches ; ici l'identite suffit, il ne reste qu'a empecher qu'un
      compte a lui seul epuise le budget.
    */
    TURN_RATE_PER_HOUR: z.coerce.number().int().positive().default(60),
    TURN_RATE_PER_DAY: z.coerce.number().int().positive().default(300),

    /*
      Le classificateur de moderation. Vide, seule la couche lexicale tourne :
      elle arrete l'evidence, pas le reste.
    */
    MODERATION_MODEL: z.string().default('qwen/qwen3-8b'),
    MODERATION_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(40),

    // Modele d'embeddings, pour la memoire longue du meneur.
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

  // Faux tant qu'aucun modele n'a ete retenu par l'evaluation.

  get provider(): 'openrouter' | 'openai' {
    return this.env.LLM_NARRATOR_PROVIDER;
  }

  // Jamais journalisee ni renvoyee : elle ne sort que vers createLlmClient.
  get apiKey(): string {
    return this.provider === 'openrouter'
      ? this.env.OPENROUTER_API_KEY
      : this.env.OPENAI_API_KEY;
  }

  /*
    Le modele d'un role, du registre code en dur de `packages/llm`. Le corps
    supplementaire, lui, reste dans l'environnement : il depend du
    fournisseur, pas du role.
  */
  modelFor(role: LlmRole) {
    return { ...LLM_MODELS[role], extraBody: this.extraBody };
  }

  // Les modeles a comparer. Lus par le script d'evaluation seul.
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
      /*
        Le meme corps que la narration, meme fournisseur et memes exigences.
        Sans lui, le classificateur facturait 140 a 178 jetons de raisonnement
        pour un verdict d'une ligne, et le texte du joueur partait sans
        `data_collection: deny`.
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
