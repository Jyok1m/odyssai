import { z } from 'zod';

/*
  Ou en est le joueur. `username` n'existe pas dans l'enumeration de la base :
  il se deduit de la presence d'un pseudo, et le stocker en ferait une seconde
  verite. Les autres valeurs suivent la colonne `universes.step`.
*/
export const OnboardingStepSchema = z.enum([
  'username',
  'inspiration',
  'character',
  'generating',
  'ready',
  'failed',
]);

export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;

// Les deux facons de nourrir la generation. Exclusives par construction.
export const InspirationModeSchema = z.enum(['works', 'own']);

export type InspirationMode = z.infer<typeof InspirationModeSchema>;

export const WORKS_MAX = 5;
export const WORK_TITLE_MAX = 80;
export const OWN_DESCRIPTION_MIN = 200;
export const OWN_DESCRIPTION_MAX = 2000;

const WorkTitle = z.string().trim().min(2).max(WORK_TITLE_MAX);

/*
  Deux titres qui se normalisent pareil sont le meme titre. La regle du joueur
  (pas deux tomes d'une meme serie) ne se verifie pas ici : il faudrait
  connaitre les franchises. C'est la passe d'abstraction qui la porte, en
  fondant les themes plutot qu'en les additionnant.
*/
export function normalizeWorkTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const distinctWorks = (works: string[]) =>
  new Set(works.map(normalizeWorkTitle)).size === works.length;

/*
  Ce qui se sauvegarde a chaque frappe. Volontairement permissif : un joueur
  qui revient doit retrouver deux titres sur cinq, ou trois lignes de
  description, exactement comme il les a laisses.
*/
export const InspirationDraftSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('works'),
    works: z.array(WorkTitle).max(WORKS_MAX).refine(distinctWorks, {
      message: 'deux fois la meme oeuvre',
    }),
  }),
  z.object({
    mode: z.literal('own'),
    ownDescription: z.string().trim().max(OWN_DESCRIPTION_MAX),
  }),
]);

export type InspirationDraft = z.infer<typeof InspirationDraftSchema>;

// Ce qu'il faut avoir rempli pour passer a l'etape suivante.
export const InspirationSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('works'),
    works: z
      .array(WorkTitle)
      .min(1)
      .max(WORKS_MAX)
      .refine(distinctWorks, { message: 'deux fois la meme oeuvre' }),
  }),
  z.object({
    mode: z.literal('own'),
    ownDescription: z.string().trim().min(OWN_DESCRIPTION_MIN).max(OWN_DESCRIPTION_MAX),
  }),
]);

export type Inspiration = z.infer<typeof InspirationSchema>;

export const CHARACTER_NAME_MAX = 60;
export const TRAITS_MAX = 5;
export const ATTRIBUTES_MAX = 8;

/*
  Bornes de l'age tres larges : un monde peut avoir des siecles de longevite,
  et c'est sa charte qui tranche, pas ce schema.
*/
const Age = z.number().int().min(1).max(1000);

/*
  Le vocabulaire des attributs appartiendra au moteur, qui n'existe pas encore.
  D'ici la, un dictionnaire borne : assez pour stocker ce que la conversation
  produit, pas assez pour qu'un texte de joueur y passe en entier.
*/
const Attributes = z
  .record(z.string().trim().min(1).max(40), z.number().int().min(1).max(5))
  .refine((value) => Object.keys(value).length <= ATTRIBUTES_MAX, {
    message: `${ATTRIBUTES_MAX} attributs au plus`,
  });

const Personality = z.object({
  traits: z.array(z.string().trim().min(2).max(40)).max(TRAITS_MAX),
  summary: z.string().trim().max(500),
});

// Sauvegarde continue, comme pour l'inspiration : tout est facultatif.
export const CharacterDraftSchema = z.object({
  name: z.string().trim().max(CHARACTER_NAME_MAX).optional(),
  gender: z.string().trim().max(40).optional(),
  age: Age.optional(),
  personality: Personality.optional(),
  attributes: Attributes.optional(),
});

export type CharacterDraft = z.infer<typeof CharacterDraftSchema>;

// Ce qu'il faut pour lancer la generation.
export const CharacterSheetSchema = z.object({
  name: z.string().trim().min(2).max(CHARACTER_NAME_MAX),
  gender: z.string().trim().min(1).max(40),
  age: Age,
  personality: Personality.extend({
    traits: z.array(z.string().trim().min(2).max(40)).min(1).max(TRAITS_MAX),
  }),
  attributes: Attributes,
});

export type CharacterSheet = z.infer<typeof CharacterSheetSchema>;

export const GenerationStatusSchema = z.enum([
  'queued',
  'running',
  'done',
  'failed',
]);

export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;

// Les noeuds du graphe, dans leur ordre d'execution.
export const GenerationStepSchema = z.enum([
  'abstraction',
  'charter',
  'lore',
  'factions',
  'politics',
  'characters',
  'affinities',
  'validation',
]);

export type GenerationStep = z.infer<typeof GenerationStepSchema>;

export const GenerationProgressSchema = z.object({
  status: GenerationStatusSchema,
  step: GenerationStepSchema.nullable(),
  // Message court, jamais un prompt ni une cle.
  error: z.string().max(500).nullable(),
});

export type GenerationProgress = z.infer<typeof GenerationProgressSchema>;

/*
  Reponse de GET /onboarding. Tout ce qu'il faut pour reprendre exactement la
  ou le joueur s'etait arrete, en un seul appel.
*/
export const OnboardingStateSchema = z.object({
  // Nul tant que le joueur n'a rien sauvegarde : la ligne n'existe pas.
  universeId: z.uuid().nullable(),
  step: OnboardingStepSchema,
  username: z.string().nullable(),
  inspiration: InspirationDraftSchema.nullable(),
  character: CharacterDraftSchema.nullable(),
  generation: GenerationProgressSchema.nullable(),
});

export type OnboardingState = z.infer<typeof OnboardingStateSchema>;

/*
  Corps de PUT /onboarding. Discrimine par l'etape, pour qu'une charge utile
  ne puisse pas etre validee contre la mauvaise etape.
*/
export const OnboardingUpdateSchema = z.discriminatedUnion('step', [
  z.object({
    step: z.literal('inspiration'),
    inspiration: InspirationDraftSchema,
    // Vrai pour passer a l'etape suivante : la validation stricte s'applique.
    advance: z.boolean().default(false),
  }),
  z.object({
    step: z.literal('character'),
    character: CharacterDraftSchema,
    advance: z.boolean().default(false),
  }),
]);

export type OnboardingUpdate = z.infer<typeof OnboardingUpdateSchema>;

// Refus de PUT /onboarding.
export const OnboardingErrorBodySchema = z.object({
  code: z.enum([
    'validation_error',
    // L'etape envoyee n'est pas celle ou en est le joueur.
    'wrong_step',
    // Le contenu ne suffit pas pour avancer, mais il a ete sauvegarde.
    'incomplete',
    // Une generation est en cours ou terminee : le parcours est ferme.
    'locked',
    // La reserve de credits est epuisee.
    'out_of_credits',
  ]),
});

export type OnboardingErrorBody = z.infer<typeof OnboardingErrorBodySchema>;

export const CHARACTER_MESSAGE_MAX_CHARS = 600;

/*
  Bornes de la conversation de creation. Le minimum decide quand la fiche peut
  etre proposee, le maximum ferme les echanges : un joueur authentifie n'a pas
  de limite par adresse, c'est donc le nombre de tours qui borne le cout.
*/
export const CHARACTER_TURNS_MIN = 3;
export const CHARACTER_TURNS_MAX = 12;

export const ConversationMessageSchema = z.object({
  id: z.uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: z.iso.datetime(),
});

export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

// Reponse de GET /onboarding/character. Tout ce qu'il faut pour reprendre.
export const CharacterConversationSchema = z.object({
  messages: z.array(ConversationMessageSchema),
  // Tours de joueur restants avant la fermeture de la conversation.
  turnsLeft: z.number().int().nonnegative(),
  // Vrai des que la conversation porte assez pour proposer une fiche.
  canExtract: z.boolean(),
});

export type CharacterConversation = z.infer<typeof CharacterConversationSchema>;

export const CharacterMessageRequestSchema = z.object({
  content: z.string().trim().min(1).max(CHARACTER_MESSAGE_MAX_CHARS),
});

export type CharacterMessageRequest = z.infer<
  typeof CharacterMessageRequestSchema
>;

// Evenements du flux SSE, un objet JSON par ligne `data:`.
export const CharacterStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({
    type: z.literal('done'),
    turnsLeft: z.number().int().nonnegative(),
    canExtract: z.boolean(),
    /*
      Le joueur a demande sa fiche : l'ecran la dresse sans attendre un clic.
      Jamais vrai tant que `canExtract` est faux, la conversation n'ayant alors
      pas de quoi remplir quoi que ce soit.
    */
    sheet: z.boolean(),
  }),
  z.object({
    type: z.literal('error'),
    code: z.enum(['upstream_error', 'internal_error']),
  }),
]);

export type CharacterStreamEvent = z.infer<typeof CharacterStreamEventSchema>;

/*
  Proposition de fiche. Elle n'est pas enregistree : le modele propose, le
  schema tranche, le joueur corrige, et c'est PUT /onboarding qui ecrit.
*/
export const CharacterExtractResponseSchema = z.object({
  character: CharacterDraftSchema,
  // Ce que le modele n'a pas su tirer de la conversation.
  missing: z.array(z.string()),
});

export type CharacterExtractResponse = z.infer<
  typeof CharacterExtractResponseSchema
>;

export const CharacterErrorBodySchema = z.object({
  code: z.enum([
    'validation_error',
    // Le joueur n'est pas a l'etape du personnage.
    'wrong_step',
    // La generation est lancee : la conversation est close.
    'locked',
    // Le nombre de tours est epuise. La fiche reste extractible.
    'conversation_over',
    // Trop peu d'echanges pour proposer quoi que ce soit.
    'too_short',
    // Le message a ete refuse par la moderation.
    'refused',
    // La reserve de credits est epuisee.
    'out_of_credits',
    'upstream_error',
  ]),
});

export type CharacterErrorBody = z.infer<typeof CharacterErrorBodySchema>;

/*
  Ce qu'il est advenu d'un monde et d'un personnage quand leur joueur s'en va.

  `kept` et `remembered` ne sont pas des echecs de suppression : un monde deja
  visite par d'autres joueurs et un personnage deja rencontre leur
  appartiennent aussi, et les effacer creverait un trou dans leurs recits.
*/
export const DepartureOutcomeSchema = z.object({
  world: z.enum(['deleted', 'kept', 'none']),
  character: z.enum(['deleted', 'remembered', 'none']),
});

export type DepartureOutcome = z.infer<typeof DepartureOutcomeSchema>;

/*
  Reponse de DELETE /me. L'identite vit dans le realm, que l'api n'a pas le
  droit de toucher : elle rend l'adresse de la console de compte pour que le
  joueur y termine lui-meme.
*/
export const AccountErasureSchema = DepartureOutcomeSchema.extend({
  accountUrl: z.url(),
});

export type AccountErasure = z.infer<typeof AccountErasureSchema>;
