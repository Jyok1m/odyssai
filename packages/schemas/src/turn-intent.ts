import { z } from 'zod';

/** Bornee volontairement : tout texte joueur est une donnee non fiable. */
export const TurnIntent = z.object({
  type: z.enum(['move', 'talk', 'act', 'use', 'observe']),
  target: z.string().max(80).optional(),
  approach: z.string().max(200).optional(),
});

export type TurnIntent = z.infer<typeof TurnIntent>;
