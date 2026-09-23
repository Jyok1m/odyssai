import { z } from 'zod';
import { OnboardingStepSchema } from './onboarding.js';

/*
  Combien d'histoires un joueur peut mener de front. Une histoire vide ne
  coute rien, mais chacune se liste et se reprend : au dela, la liste cesse
  d'etre un choix.
*/
export const STORIES_MAX = 6;

/*
  Une histoire vue de la liste : de quoi la reconnaitre et savoir ou elle en
  est. `name` est nul tant que le monde n'est pas genere.
*/
export const StorySchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  step: OnboardingStepSchema.exclude(['username']),
  accentHue: z.number().int().nullable(),
  current: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Story = z.infer<typeof StorySchema>;

export const StoriesSchema = z.object({
  stories: z.array(StorySchema),
  max: z.number().int(),
});

export type Stories = z.infer<typeof StoriesSchema>;

/*
  Ce qu'on envoie pour commencer une histoire.

  Sans essence, c'est un personnage neuf, et le parcours passe par la
  conversation de creation. Avec, c'en est un qu'on amene : sa fiche arrive
  deja remplie, et il entre en voyageur.
*/
export const StoryStartSchema = z.object({
  essenceId: z.uuid().optional(),
});

export type StoryStart = z.infer<typeof StoryStartSchema>;

export const StoriesErrorBodySchema = z.object({
  // `locked` : l'histoire est en construction, on ne l'efface pas sous le worker.
  code: z.enum([
    'not_found',
    'stories_full',
    'locked',
    'validation_error',
    // L'essence demandee n'existe pas, ou n'est pas a ce joueur.
    'traveller_not_found',
  ]),
});

export type StoriesErrorBody = z.infer<typeof StoriesErrorBodySchema>;
