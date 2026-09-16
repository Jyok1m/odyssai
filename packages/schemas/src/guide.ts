import { z } from 'zod';
import { UiLocale } from './auth.js';

/**
 * Longueur maximale d'une question. Constante partagee et non variable
 * d'environnement : le compteur du champ de saisie doit afficher la meme borne
 * que celle appliquee par l'API.
 */
export const GUIDE_QUESTION_MAX_CHARS = 300;

/**
 * Une question, seule. Pas d'historique : chaque question est traitee
 * independamment, ce qui rend les reponses de FAQ reutilisables et le cout
 * previsible.
 */
export const GuideAskRequestSchema = z.object({
  question: z.string().trim().min(1).max(GUIDE_QUESTION_MAX_CHARS),
  locale: UiLocale,
});

export type GuideAskRequest = z.infer<typeof GuideAskRequestSchema>;

export const GuidePassRequestSchema = z.object({
  turnstileToken: z.string().min(1).max(2048),
});

export type GuidePassRequest = z.infer<typeof GuidePassRequestSchema>;

/**
 * D'ou vient la reponse. `faq` ne coute rien, `llm` est une generation,
 * `off_topic` et `degraded` sont des textes fixes ecrits cote serveur.
 */
export const GuideAnswerSourceSchema = z.enum([
  'faq',
  'llm',
  'off_topic',
  'degraded',
]);

export type GuideAnswerSource = z.infer<typeof GuideAnswerSourceSchema>;

/** Evenements du flux SSE, un objet JSON par ligne `data:`. */
export const GuideStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('meta'), source: GuideAnswerSourceSchema }),
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('done') }),
  z.object({
    type: z.literal('error'),
    code: z.enum(['upstream_error', 'internal_error']),
  }),
]);

export type GuideStreamEvent = z.infer<typeof GuideStreamEventSchema>;

/**
 * Corps des refus, avant l'ouverture du flux. Volontairement grossier : le
 * detail reste dans les journaux du serveur.
 */
export const GuideErrorBodySchema = z.object({
  code: z.enum([
    'validation_error',
    'pass_required',
    'pass_unavailable',
    'rate_limited',
    'busy',
  ]),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
});

export type GuideErrorBody = z.infer<typeof GuideErrorBodySchema>;

export const GuideSuggestionsResponseSchema = z.object({
  suggestions: z.array(
    z.object({
      id: z.string().min(1),
      question: z.string().min(1),
    }),
  ),
});

export type GuideSuggestionsResponse = z.infer<
  typeof GuideSuggestionsResponseSchema
>;
