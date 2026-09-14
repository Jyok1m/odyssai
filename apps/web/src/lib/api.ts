import { SessionState, SignOutResult, type UiLocale } from "@odyssai/schemas";

/**
 * Accès à l'API depuis le navigateur. Elle est sur une autre origine et détient
 * le cookie de session, d'où `credentials: "include"` sur chaque appel.
 *
 * Ce cookie est en SameSite=Lax et part quand même, parce que « same-site » se
 * juge sur le domaine enregistrable et non sur l'origine. Déplacer l'API sur un
 * autre domaine casserait la lecture de session sans rien changer au code.
 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001"
).replace(/\/+$/, "");

/**
 * URL de connexion, à suivre par une navigation de premier niveau et non par
 * fetch : l'API répond une redirection vers Keycloak, qui refuse d'être chargé
 * en requête de second plan. `redirectTo` est un chemin interne, revalidé côté
 * API : une URL absolue ferait de /auth/signin un redirecteur ouvert.
 */
export function signInUrl(redirectTo: string, locale: UiLocale): string {
  return authUrl("signin", redirectTo, locale);
}

/** Même flot, sur la page d'inscription du realm. */
export function signUpUrl(redirectTo: string, locale: UiLocale): string {
  return authUrl("signup", redirectTo, locale);
}

/**
 * `locale` repart en ui_locales : sans elle, Keycloak sert la langue du realm
 * et le joueur changerait de langue en passant par la connexion.
 */
function authUrl(
  kind: "signin" | "signup",
  redirectTo: string,
  locale: UiLocale,
): string {
  const url = new URL(`/auth/${kind}`, API_BASE_URL);
  url.searchParams.set("redirect", redirectTo);
  url.searchParams.set("locale", locale);
  return url.toString();
}

/** État d'authentification courant. La réponse ne porte jamais de jeton. */
export async function fetchSession(signal?: AbortSignal): Promise<SessionState> {
  const response = await fetch(`${API_BASE_URL}/auth/session`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    // Une réponse en cache ferait survivre un état périmé à la déconnexion.
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`GET /auth/session a répondu ${response.status}`);
  }

  return SessionState.parse(await response.json());
}

/**
 * Ferme la session serveur et rend l'URL de déconnexion Keycloak, que le front
 * doit suivre : sinon la session SSO reste ouverte et la connexion suivante
 * repasserait sans mot de passe.
 */
export async function requestSignOut(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/auth/signout`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`POST /auth/signout a répondu ${response.status}`);
  }

  return SignOutResult.parse(await response.json()).logoutUrl;
}
