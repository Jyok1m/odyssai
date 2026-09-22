import { z } from 'zod';

export const TURN_MESSAGE_MAX_CHARS = 600;

// Au dela, le meneur invente plus qu'il ne repond.
export const CANON_FACTS_PER_TURN_MAX = 3;

/*
  Un fait que le meneur a invente en repondant a une question que le lore ne
  couvrait pas. Il entre au canon et nourrit tous les tours suivants : c'est
  ce qui fait qu'une reponse donnee une fois reste vraie.
*/
export const CanonFactSchema = z.object({
  // De quoi ca parle, en quelques mots. Sert a relire et a regrouper.
  subject: z.string().trim().min(2).max(80),
  statement: z.string().trim().min(10).max(400),
});

export type CanonFact = z.infer<typeof CanonFactSchema>;

/*
  Ce que le joueur envoie. Deux formes seulement : il dit ce qu'il fait ou
  demande, ou il s'en remet au sort quand il ne sait pas quoi faire.
*/
export const TurnRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('say'),
    content: z.string().trim().min(1).max(TURN_MESSAGE_MAX_CHARS),
  }),
  z.object({ kind: z.literal('fate') }),
  /*
    La premiere scene, jouee par le meneur sans que le joueur ait rien dit.

    Sans elle le joueur arrive devant un champ vide et doit deviner qu'il
    commence : c'est le meneur qui ouvre une partie, pas celui qui la joue.
    L'api la refuse des qu'un tour existe, sinon elle se rejouerait a chaque
    rechargement, et chaque fois pour un credit.
  */
  z.object({ kind: z.literal('open') }),
]);

export type TurnRequest = z.infer<typeof TurnRequestSchema>;

/*
  Ce que le joueur apprend du de : deux etats, et seulement quand l'issue
  etait incertaine. Le chiffre ne sort jamais du serveur, et une question sur
  le lore ne se tranche pas au de, donc `null` y est la bonne reponse.
*/
export const PublicOutcomeSchema = z.enum(['favorable', 'defavorable']);

export type PublicOutcome = z.infer<typeof PublicOutcomeSchema>;

/*
  Le bloc rendu par le modele en queue de reponse. Le code s'en sert pour
  savoir quoi ecrire ; le joueur, lui, a deja tout lu dans la prose.
*/
export const TurnDeltaSchema = z.object({
  kind: z.enum(['action', 'question']),
  // Vrai si l'issue etait incertaine et que la bande a colore le recit.
  usedDie: z.boolean(),
  facts: z.array(CanonFactSchema).max(CANON_FACTS_PER_TURN_MAX).default([]),
});

export type TurnDelta = z.infer<typeof TurnDeltaSchema>;

// Evenements du flux SSE, un objet JSON par ligne `data:`.
export const TurnStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({
    type: z.literal('done'),
    // Nul quand le de n'a pas servi : rien a annoncer.
    outcome: PublicOutcomeSchema.nullable(),
    // Nombre de faits entres au canon a ce tour, pour le dire a l'ecran.
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
  // Porte par la reponse du meneur, jamais par le message du joueur.
  outcome: PublicOutcomeSchema.nullable(),
  createdAt: z.iso.datetime(),
});

export type TurnMessage = z.infer<typeof TurnMessageSchema>;

// Reponse de GET /turn : de quoi reprendre la partie ou on l'a laissee.
export const TurnHistorySchema = z.object({
  messages: z.array(TurnMessageSchema),
  // Les faits que le meneur a inventes, pour que le joueur puisse les relire.
  canon: z.array(CanonFactSchema),
});

export type TurnHistory = z.infer<typeof TurnHistorySchema>;

export const TurnErrorBodySchema = z.object({
  code: z.enum([
    'validation_error',
    // Le monde n'est pas encore genere.
    'not_ready',
    'rate_limited',
    'busy',
    // La reserve de credits est epuisee.
    'out_of_credits',
    // Le message a ete refuse par la moderation.
    'refused',
    'upstream_error',
  ]),
  // Presente sur un refus. Sert a choisir le message, jamais affichee brute.
  reason: z
    .enum(['insulte', 'haine', 'sexuel', 'minorite', 'violence_gratuite'])
    .nullable()
    .optional(),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
  // Presents sur un refus pour reserve vide, pour que l'ecran sache quoi dire.
  needed: z.number().int().nonnegative().optional(),
  balance: z.number().int().nonnegative().optional(),
});

export type TurnErrorBody = z.infer<typeof TurnErrorBodySchema>;

/*
  Verdict de moderation. `reason` n'est jamais rendu au joueur tel quel : il
  sert au journal et a choisir le message affiche.
*/
export const ModerationVerdictSchema = z.object({
  allow: z.boolean(),
  reason: z
    .enum(['insulte', 'haine', 'sexuel', 'minorite', 'violence_gratuite'])
    .nullable()
    .default(null),
  /*
    Code de la langue du message, en deux ou trois lettres. Le classificateur
    lit deja la phrase : la lui demander ne coute rien, la detecter ailleurs
    couterait un appel ou une dependance.

    Pas une enumeration : le joueur peut ecrire dans n'importe quelle langue,
    et seule la distinction « francais ou non » est exploitee.
  */
  language: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2,3}$/)
    .nullable()
    .default(null),
});

export type ModerationVerdict = z.infer<typeof ModerationVerdictSchema>;

/*
  Ce que le joueur vient de faire, lu dans sa seule phrase : ce sont des actes
  de langage, pas des etats de scene. Une situation qui demanderait
  l'historique (la scene s'enlise, il repete la meme action) viendrait du code,
  pas du classificateur, qui ne voit que ce message.

  Sans accent : le prompt qui les cite est en francais accentue, et un modele
  serviable corrigerait `demesure` en `démesure`. Le prompt devra le dire.
*/
export const SituationSchema = z.enum([
  'violence',
  'contrainte',
  'tromperie',
  'echange',
  'interrogation',
  'lore',
  'exploration',
  'entreprise',
  'intimite',
  'demesure',
  'attente',
  'meta',
]);

export type Situation = z.infer<typeof SituationSchema>;

// Au dela, le rappel pese autant que les consignes permanentes du meneur.
export const GUIDANCE_PER_TURN_MAX = 2;
