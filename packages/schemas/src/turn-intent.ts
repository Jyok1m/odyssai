import { z } from 'zod';

/**
 * Intention brute soumise par un joueur pour un tour.
 * Bornee volontairement : tout texte joueur est une donnee non fiable.
 */
export const TurnIntent = z.object({
  type: z.enum(['move', 'talk', 'act', 'use', 'observe']),
  target: z.string().max(80).optional(),
  approach: z.string().max(200).optional(),
});

export type TurnIntent = z.infer<typeof TurnIntent>;
