import { z } from 'zod';

/**
 * Ou en est le joueur. `username` n'existe pas dans l'enumeration de la base :
 * il se deduit de la presence d'un pseudo, et le stocker en ferait une seconde
 * verite. Les autres valeurs suivent la colonne `universes.step`.
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

/** Les deux facons de nourrir la generation. Exclusives par construction. */
export const InspirationModeSchema = z.enum(['works', 'own']);

export type InspirationMode = z.infer<typeof InspirationModeSchema>;

export const WORKS_MAX = 5;
export const WORK_TITLE_MAX = 80;
export const OWN_DESCRIPTION_MIN = 200;
export const OWN_DESCRIPTION_MAX = 2000;

const WorkTitle = z.string().trim().min(2).max(WORK_TITLE_MAX);

/**
 * Deux titres qui se normalisent pareil sont le meme titre. La regle du joueur
 * (pas deux tomes d'une meme serie) ne se verifie pas ici : il faudrait
 * connaitre les franchises. C'est la passe d'abstraction qui la porte, en
 * fondant les themes plutot qu'en les additionnant.
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

/**
 * Ce qui se sauvegarde a chaque frappe. Volontairement permissif : un joueur
 * qui revient doit retrouver deux titres sur cinq, ou trois lignes de
 * description, exactement comme il les a laisses.
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

/** Ce qu'il faut avoir rempli pour passer a l'etape suivante. */
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

/**
 * Bornes de l'age tres larges : un monde peut avoir des siecles de longevite,
 * et c'est sa charte qui tranche, pas ce schema.
 */
const Age = z.number().int().min(1).max(1000);

/**
 * Le vocabulaire des attributs appartiendra au moteur, qui n'existe pas encore.
 * D'ici la, un dictionnaire borne : assez pour stocker ce que la conversation
 * produit, pas assez pour qu'un texte de joueur y passe en entier.
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

/** Sauvegarde continue, comme pour l'inspiration : tout est facultatif. */
export const CharacterDraftSchema = z.object({
  name: z.string().trim().max(CHARACTER_NAME_MAX).optional(),
  gender: z.string().trim().max(40).optional(),
  age: Age.optional(),
  personality: Personality.optional(),
  attributes: Attributes.optional(),
});

export type CharacterDraft = z.infer<typeof CharacterDraftSchema>;

/** Ce qu'il faut pour lancer la generation. */
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

/** Les noeuds du graphe, dans leur ordre d'execution. */
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
  /** Message court, jamais un prompt ni une cle. */
  error: z.string().max(500).nullable(),
});

export type GenerationProgress = z.infer<typeof GenerationProgressSchema>;

/**
 * Reponse de GET /onboarding. Tout ce qu'il faut pour reprendre exactement la
 * ou le joueur s'etait arrete, en un seul appel.
 */
export const OnboardingStateSchema = z.object({
  /** Nul tant que le joueur n'a rien sauvegarde : la ligne n'existe pas. */
  universeId: z.uuid().nullable(),
  step: OnboardingStepSchema,
  username: z.string().nullable(),
  inspiration: InspirationDraftSchema.nullable(),
  character: CharacterDraftSchema.nullable(),
  generation: GenerationProgressSchema.nullable(),
});

export type OnboardingState = z.infer<typeof OnboardingStateSchema>;

/**
 * Corps de PUT /onboarding. Discrimine par l'etape, pour qu'une charge utile
 * ne puisse pas etre validee contre la mauvaise etape.
 */
export const OnboardingUpdateSchema = z.discriminatedUnion('step', [
  z.object({
    step: z.literal('inspiration'),
    inspiration: InspirationDraftSchema,
    /** Vrai pour passer a l'etape suivante : la validation stricte s'applique. */
    advance: z.boolean().default(false),
  }),
  z.object({
    step: z.literal('character'),
    character: CharacterDraftSchema,
    advance: z.boolean().default(false),
  }),
]);

export type OnboardingUpdate = z.infer<typeof OnboardingUpdateSchema>;

/** Refus de PUT /onboarding. */
export const OnboardingErrorBodySchema = z.object({
  code: z.enum([
    'validation_error',
    /** L'etape envoyee n'est pas celle ou en est le joueur. */
    'wrong_step',
    /** Le contenu ne suffit pas pour avancer, mais il a ete sauvegarde. */
    'incomplete',
    /** Une generation est en cours ou terminee : le parcours est ferme. */
    'locked',
  ]),
});

export type OnboardingErrorBody = z.infer<typeof OnboardingErrorBodySchema>;
