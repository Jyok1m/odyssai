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
  /**
   * Console de compte du realm, ou se changent l'email et le mot de passe.
   * Construite par l'API : le navigateur n'a pas a connaitre l'URL du realm,
   * et elle change d'un environnement a l'autre.
   */
  accountUrl: z.url(),
});

export type PlayerProfile = z.infer<typeof PlayerProfile>;

/**
 * Pseudo dans le jeu. Il n'existe pas dans le realm : c'est la seule piece de
 * l'identite que l'application decide.
 *
 * Bornes lexicales volontairement etroites : le pseudo est affiche aux autres
 * joueurs, donc pas de caracteres de controle, pas d'espaces en lisiere ni
 * doubles, et il commence et finit par une lettre ou un chiffre. L'unicite,
 * elle, est insensible a la casse et se joue en base.
 */
export const Username = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(
    /^[\p{L}\p{N}][\p{L}\p{N} '\u2019-]*[\p{L}\p{N}]$/u,
    'lettres, chiffres, espace, tiret et apostrophe uniquement',
  )
  .refine((value) => !/\s{2}/.test(value), 'pas deux espaces de suite');

export type Username = z.infer<typeof Username>;

export const UpdateProfileRequestSchema = z.object({ username: Username });

export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

/**
 * Refus de PATCH /me. `username_locked` dit que le pseudo est deja pose : il
 * ne se choisit qu'une fois, et c'est l'API qui le garantit, pas l'ecran.
 */
export const ProfileErrorBodySchema = z.object({
  code: z.enum(['validation_error', 'username_taken', 'username_locked']),
});

export type ProfileErrorBody = z.infer<typeof ProfileErrorBodySchema>;
