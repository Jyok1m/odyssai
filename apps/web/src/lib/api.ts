import { SessionState, SignOutResult } from "@odyssai/schemas";

/**
 * Accès à l'API depuis le navigateur.
 *
 * L'API est sur une autre origine, et c'est elle qui détient le cookie de
 * session : chaque appel porte donc `credentials: "include"`, autorisé par le
 * CORS déclaré dans `apps/api/src/main.ts`.
 *
 * Le cookie est en SameSite=Lax. Il part quand même vers l'API parce que
 * « same-site » se juge sur le domaine enregistrable et non sur l'origine :
 * localhost:3000 vers localhost:3001 en développement, odyssai.app vers
 * api.odyssai.app en production. Déplacer l'API sur un autre domaine
 * casserait la lecture de session sans rien changer au code.
 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001"
).replace(/\/+$/, "");

/**
 * URL de connexion. Le navigateur doit y aller par une navigation de premier
 * niveau et non par fetch : l'API répond une redirection vers la page de
 * Keycloak, qui refuserait d'être chargée en requête de second plan.
 *
 * `redirectTo` est un chemin interne du site, revalidé côté API : une URL
 * absolue ferait de /auth/signin un redirecteur ouvert.
 */
export function signInUrl(redirectTo: string): string {
  return authUrl("signin", redirectTo);
}

/** Même flot, sur la page d'inscription du realm. */
export function signUpUrl(redirectTo: string): string {
  return authUrl("signup", redirectTo);
}

function authUrl(kind: "signin" | "signup", redirectTo: string): string {
  const url = new URL(`/auth/${kind}`, API_BASE_URL);
  url.searchParams.set("redirect", redirectTo);
  return url.toString();
}

/**
 * État d'authentification courant. Jamais de jeton dans la réponse : le
 * navigateur n'apprend que qui il est.
 */
export async function fetchSession(signal?: AbortSignal): Promise<SessionState> {
  const response = await fetch(`${API_BASE_URL}/auth/session`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    // La session se renouvelle côté serveur : une réponse mise en cache
    // ferait survivre un état périmé à la déconnexion.
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`GET /auth/session a répondu ${response.status}`);
  }

  return SessionState.parse(await response.json());
}

/**
 * Ferme la session serveur et rend l'URL de déconnexion Keycloak. Le front
 * doit la suivre : sans ça la session SSO du navigateur reste ouverte et la
 * connexion suivante repasserait sans mot de passe.
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
