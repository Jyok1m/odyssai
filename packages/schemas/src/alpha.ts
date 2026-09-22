import { z } from 'zod';

/*
  Ce que l'administrateur choisit d'annoncer.

  Deux phases seulement. « Complete » n'en est pas une : c'est le constat que
  les places sont prises, et il se deduit du nombre d'inscrits. Le tableau de
  bord decide de ce qu'on annonce, jamais de ce qui est vrai, sans quoi le
  site pourrait promettre des places qui n'existent plus.
*/
export const AlphaPhaseSchema = z.enum(['preregistration', 'open']);

export type AlphaPhase = z.infer<typeof AlphaPhaseSchema>;

// L'etat servi au site, sans session : il s'affiche avant de s'inscrire.
export const AlphaStatusSchema = z.object({
  phase: AlphaPhaseSchema,
  // Faux pour taire l'annonce sans changer la phase.
  notice: z.boolean(),
  // Le total, et ce qu'il en reste. Les administrateurs n'y comptent pas.
  seats: z.number().int().positive(),
  taken: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  // Le constat, pas un choix : `remaining` vaut zero.
  full: z.boolean(),
});

export type AlphaStatus = z.infer<typeof AlphaStatusSchema>;

// Ce que le tableau de bord peut changer, et rien d'autre.
export const UpdateAlphaRequestSchema = z.object({
  phase: AlphaPhaseSchema.optional(),
  notice: z.boolean().optional(),
});

export type UpdateAlphaRequest = z.infer<typeof UpdateAlphaRequestSchema>;
