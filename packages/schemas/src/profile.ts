import { z } from 'zod';
import { UiLocale } from './auth.js';

/*
  Profil de jeu, rendu par GET /me. Il appartient a la base applicative et n'a
  pas d'equivalent dans le realm : `username`, `locale` et `isAdmin` sont
  decides ici. Les revendications en miroir sont reprises pour que le front
  n'ait pas a croiser cette reponse avec celle de /auth/session.
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
  /*
    Consentement a recevoir des nouvelles. Faux par defaut, et jamais bascule
    a la place du joueur : un opt-in pre-coche n'est pas un consentement.
  */
  marketingOptIn: z.boolean().default(false),
  /*
    Console de compte du realm, ou se changent l'email et le mot de passe.
    Construite par l'API : le navigateur n'a pas a connaitre l'URL du realm,
    et elle change d'un environnement a l'autre.
  */
  accountUrl: z.url(),
});

export type PlayerProfile = z.infer<typeof PlayerProfile>;

/*
  Pseudo dans le jeu, absent du realm : la seule piece de l'identite que
  l'application decide. Bornes etroites parce qu'il est affiche aux autres
  joueurs. L'unicite est insensible a la casse et se joue en base.
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

/*
  Ce qu'un joueur change sur son profil.

  Les deux champs sont facultatifs et independants : le pseudo ne se pose
  qu'une fois, le consentement se retire autant de fois qu'on veut. Un corps
  vide est refuse plutot qu'ignore, sans quoi une requete sans effet
  repondrait comme une reussite.
*/
export const UpdateProfileRequestSchema = z
  .object({
    username: Username.optional(),
    marketingOptIn: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.username !== undefined || value.marketingOptIn !== undefined,
    { message: 'rien a mettre a jour' },
  );

export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

/*
  Refus de PATCH /me. `username_locked` dit que le pseudo est deja pose : il
  ne se choisit qu'une fois, et c'est l'API qui le garantit, pas l'ecran.
*/
export const ProfileErrorBodySchema = z.object({
  code: z.enum(['validation_error', 'username_taken', 'username_locked']),
});

export type ProfileErrorBody = z.infer<typeof ProfileErrorBodySchema>;
