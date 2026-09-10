import { z } from 'zod';

/**
 * Chemin interne sur : une seule barre oblique en tete, puis aucun caractere
 * de controle, espace, DEL ni antislash.
 *
 * Validation lexicale plutot que via URL : ce paquet est isomorphe et son
 * tsconfig ne declare ni DOM ni types Node.
 */
const SAFE_INTERNAL_PATH = new RegExp('^/(?![/\\\\])[^\\u0000-\\u0020\\u007f\\\\]*$');

/**
 * Cible de redirection apres authentification.
 *
 * Seul un chemin interne est acceptable : une URL absolue transformerait
 * /auth/signin en redirecteur ouvert, qu'un hameconnage utiliserait pour
 * renvoyer le joueur vers un faux OdyssAI apres un passage credible par
 * Keycloak. Les caracteres de controle sont exclus parce que la valeur
 * repart dans un en-tete Location.
 */
export const InternalPath = z
  .string()
  .max(512)
  .regex(SAFE_INTERNAL_PATH, 'chemin interne attendu, par exemple /jouer');

export type InternalPath = z.infer<typeof InternalPath>;

/**
 * Utilisateur courant tel que l'API l'expose au navigateur.
 * Aucun jeton n'y figure : ils ne quittent jamais le serveur.
 */
export const SessionUser = z.object({
  id: z.string().min(1),
  email: z.email(),
  emailVerified: z.boolean(),
  roles: z.array(z.string()),
});

export type SessionUser = z.infer<typeof SessionUser>;

/** Reponse de GET /auth/session. */
export const SessionState = z.discriminatedUnion('authenticated', [
  z.object({ authenticated: z.literal(true), user: SessionUser }),
  z.object({ authenticated: z.literal(false) }),
]);

export type SessionState = z.infer<typeof SessionState>;

/**
 * Codes rendus au web en parametre d'URL quand le retour de Keycloak echoue.
 * Volontairement grossiers : le detail reste dans les journaux du serveur.
 */
export const AuthErrorCode = z.enum([
  'access_denied',
  'invalid_request',
  'provider_error',
  'session_failed',
]);

export type AuthErrorCode = z.infer<typeof AuthErrorCode>;
