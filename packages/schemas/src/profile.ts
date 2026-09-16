import { z } from 'zod';
import { UiLocale } from './auth.js';

/**
 * Profil de jeu, rendu par GET /me. Il appartient a la base applicative et n'a
 * pas d'equivalent dans le realm : `username`, `locale` et `isAdmin` sont
 * decides ici. Les revendications en miroir sont reprises pour que le front
 * n'ait pas a croiser cette reponse avec celle de /auth/session.
 */
export const PlayerProfile = z.object({
  id: z.uuid(),
  username: z.string().max(32).nullable(),
  locale: UiLocale,
  isAdmin: z.boolean(),
  email: z.email(),
  emailVerified: z.boolean(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type PlayerProfile = z.infer<typeof PlayerProfile>;
