import { z } from 'zod';

// Validation lexicale plutot que via URL : ce paquet est isomorphe et son
// tsconfig ne declare ni DOM ni types Node.
const SAFE_INTERNAL_PATH = new RegExp('^/(?![/\\\\])[^\\u0000-\\u0020\\u007f\\\\]*$');

/**
 * Cible de redirection apres authentification. Seul un chemin interne est
 * acceptable : une URL absolue ferait de /auth/signin un redirecteur ouvert,
 * qu'un hameconnage utiliserait apres un passage credible par Keycloak. Les
 * caracteres de controle sont exclus parce que la valeur repart en Location.
 */
export const InternalPath = z
  .string()
  .max(512)
  .regex(SAFE_INTERNAL_PATH, 'chemin interne attendu, par exemple /jouer');

export type InternalPath = z.infer<typeof InternalPath>;

/** Utilisateur courant expose au navigateur. Aucun jeton n'y figure. */
export const SessionUser = z.object({
  id: z.string().min(1),
  email: z.email(),
  emailVerified: z.boolean(),
  roles: z.array(z.string()),
  /**
   * Le droit d'administration, lu en base et non dans les roles du realm :
   * `users.is_admin` se pose avec admin:grant, donc avec un acces au serveur,
   * et aucune route ne l'accorde. Il voyage jusqu'au navigateur pour qu'un
   * ecran sache quoi montrer, jamais pour decider : c'est `AdminGuard` qui
   * refuse vraiment.
   *
   * Absent, il vaut faux plutot que de faire echouer la lecture : les deux
   * images basculent l'une apres l'autre, et un navigateur qui charge le
   * nouveau site pendant que l'ancienne api repond encore passerait pour
   * anonyme. Le type de sortie reste `boolean`, donc l'api, elle, doit
   * toujours le fournir.
   */
  isAdmin: z.boolean().default(false),
});

export type SessionUser = z.infer<typeof SessionUser>;

/** Reponse de GET /auth/session. */
export const SessionState = z.discriminatedUnion('authenticated', [
  z.object({ authenticated: z.literal(true), user: SessionUser }),
  z.object({ authenticated: z.literal(false) }),
]);

export type SessionState = z.infer<typeof SessionState>;

/** Volontairement grossiers : le detail reste dans les journaux du serveur. */
export const AuthErrorCode = z.enum([
  'access_denied',
  'invalid_request',
  'provider_error',
  'session_failed',
]);

export type AuthErrorCode = z.infer<typeof AuthErrorCode>;

/** Reponse de POST /auth/signout. L'URL pointe la fin de session du realm. */
export const SignOutResult = z.object({
  logoutUrl: z.url(),
});

export type SignOutResult = z.infer<typeof SignOutResult>;

/**
 * Langue des pages de Keycloak, passee en ui_locales. Bornee a ce que le realm
 * declare : une valeur libre partirait telle quelle dans une URL de l'API.
 */
export const UiLocale = z.enum(['fr', 'en']);

export type UiLocale = z.infer<typeof UiLocale>;
