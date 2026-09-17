import { z } from 'zod';

export const TURN_MESSAGE_MAX_CHARS = 600;

/** Au dela, le meneur invente plus qu'il ne repond. */
export const CANON_FACTS_PER_TURN_MAX = 3;

/**
 * Un fait que le meneur a invente en repondant a une question que le lore ne
 * couvrait pas. Il entre au canon et nourrit tous les tours suivants : c'est
 * ce qui fait qu'une reponse donnee une fois reste vraie.
 */
export const CanonFactSchema = z.object({
  /** De quoi ca parle, en quelques mots. Sert a relire et a regrouper. */
  subject: z.string().trim().min(2).max(80),
  statement: z.string().trim().min(10).max(400),
});

export type CanonFact = z.infer<typeof CanonFactSchema>;

/**
 * Ce que le joueur envoie. Deux formes seulement : il dit ce qu'il fait ou
 * demande, ou il s'en remet au sort quand il ne sait pas quoi faire.
 */
export const TurnRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('say'),
    content: z.string().trim().min(1).max(TURN_MESSAGE_MAX_CHARS),
  }),
  z.object({ kind: z.literal('fate') }),
]);

export type TurnRequest = z.infer<typeof TurnRequestSchema>;

/**
 * Ce que le joueur apprend du de : deux etats, et seulement quand l'issue
 * etait incertaine. Le chiffre ne sort jamais du serveur, et une question sur
 * le lore ne se tranche pas au de, donc `null` y est la bonne reponse.
 */
export const PublicOutcomeSchema = z.enum(['favorable', 'defavorable']);

export type PublicOutcome = z.infer<typeof PublicOutcomeSchema>;

/**
 * Le bloc rendu par le modele en queue de reponse. Le code s'en sert pour
 * savoir quoi ecrire ; le joueur, lui, a deja tout lu dans la prose.
 */
export const TurnDeltaSchema = z.object({
  kind: z.enum(['action', 'question']),
  /** Vrai si l'issue etait incertaine et que la bande a colore le recit. */
  usedDie: z.boolean(),
  facts: z.array(CanonFactSchema).max(CANON_FACTS_PER_TURN_MAX).default([]),
});

export type TurnDelta = z.infer<typeof TurnDeltaSchema>;

/** Evenements du flux SSE, un objet JSON par ligne `data:`. */
export const TurnStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({
    type: z.literal('done'),
    /** Nul quand le de n'a pas servi : rien a annoncer. */
    outcome: PublicOutcomeSchema.nullable(),
    /** Nombre de faits entres au canon a ce tour, pour le dire a l'ecran. */
    learned: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('error'),
    code: z.enum(['upstream_error', 'internal_error']),
  }),
]);

export type TurnStreamEvent = z.infer<typeof TurnStreamEventSchema>;

export const TurnMessageSchema = z.object({
  id: z.uuid(),
  seq: z.number().int().nonnegative(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  /** Porte par la reponse du meneur, jamais par le message du joueur. */
  outcome: PublicOutcomeSchema.nullable(),
  createdAt: z.iso.datetime(),
});

export type TurnMessage = z.infer<typeof TurnMessageSchema>;

/** Reponse de GET /turn : de quoi reprendre la partie ou on l'a laissee. */
export const TurnHistorySchema = z.object({
  messages: z.array(TurnMessageSchema),
  /** Les faits que le meneur a inventes, pour que le joueur puisse les relire. */
  canon: z.array(CanonFactSchema),
});

export type TurnHistory = z.infer<typeof TurnHistorySchema>;

export const TurnErrorBodySchema = z.object({
  code: z.enum([
    'validation_error',
    /** Le monde n'est pas encore genere. */
    'not_ready',
    'rate_limited',
    'busy',
    'upstream_error',
  ]),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
});

export type TurnErrorBody = z.infer<typeof TurnErrorBodySchema>;
