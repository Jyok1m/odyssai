import { z } from 'zod';

/*
  Ouvert ou ferme, regle au tableau de bord. `preregistration` est la valeur
  historique de « ferme » : les portes ne se ferment plus que pour une
  maintenance ou une remise a zero, mais la colonne garde son mot.
*/
export const AlphaPhaseSchema = z.enum(['preregistration', 'open']);

export type AlphaPhase = z.infer<typeof AlphaPhaseSchema>;

// L'etat servi au site, sans session : il s'affiche avant de s'inscrire.
export const AlphaStatusSchema = z.object({
  phase: AlphaPhaseSchema,
  // Faux pour taire l'annonce sans changer la phase.
  notice: z.boolean(),
  // La vente des paliers. Fermee le temps de l'alpha : tout le monde joue
  // sur le palier libre, et les premiers inscrits ont leur bonus.
  salesOpen: z.boolean(),
  /*
    Les premiers inscrits et leur bonus : combien de places, combien de
    credits, combien sont prises, combien restent. Un cadeau, pas une porte :
    au dela, on entre quand meme. Les administrateurs n'y comptent pas.
  */
  founders: z.object({
    seats: z.number().int().positive(),
    credits: z.number().int().positive(),
    taken: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
  }),
});

export type AlphaStatus = z.infer<typeof AlphaStatusSchema>;

// Ce que le tableau de bord peut changer, et rien d'autre.
export const UpdateAlphaRequestSchema = z.object({
  phase: AlphaPhaseSchema.optional(),
  notice: z.boolean().optional(),
  salesOpen: z.boolean().optional(),
});

export type UpdateAlphaRequest = z.infer<typeof UpdateAlphaRequestSchema>;
