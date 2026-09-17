import {
  AccountErasureSchema,
  PlayerProfile,
  UpdateProfileRequestSchema,
  type AccountErasure,
  type ProfileErrorBody,
} from "@odyssai/schemas";

import { API_BASE_URL } from "./api";

/** Refus de l'API sur le profil. `username_taken` est le seul cas métier. */
export class ProfileError extends Error {
  readonly code:
    | ProfileErrorBody["code"]
    | "unauthenticated"
    /** L'API n'a pas répondu : réseau coupé, ou origine refusée. */
    | "unreachable"
    | "unknown";

  constructor(code: ProfileError["code"]) {
    super(code);
    this.name = "ProfileError";
    this.code = code;
  }
}

export async function fetchProfile(signal?: AbortSignal): Promise<PlayerProfile> {
  const response = await send(
    `${API_BASE_URL}/me`,
    {
      credentials: "include",
      headers: { Accept: "application/json" },
      // Une réponse en cache ferait survivre un pseudo périmé à sa modification.
      cache: "no-store",
      signal,
    },
    () => new ProfileError("unreachable"),
  );

  if (!response.ok) throw await toProfileError(response);
  return PlayerProfile.parse(await response.json());
}

export async function updateUsername(username: string): Promise<PlayerProfile> {
  // Validé ici aussi : le même schéma que l'API, donc le champ répond avant
  // l'aller-retour et l'API reste seule juge.
  const body = UpdateProfileRequestSchema.parse({ username });

  const response = await send(
    `${API_BASE_URL}/me`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    },
    () => new ProfileError("unreachable"),
  );

  if (!response.ok) throw await toProfileError(response);
  return PlayerProfile.parse(await response.json());
}

/**
 * Le départ. Efface les données de jeu et ferme la session ; l'identité reste
 * chez Keycloak, et `accountUrl` mène là où le joueur la supprimera lui-même.
 */
export async function eraseAccount(): Promise<AccountErasure> {
  const response = await send(
    `${API_BASE_URL}/me`,
    { method: "DELETE", credentials: "include" },
    () => new ProfileError("unreachable"),
  );

  if (!response.ok) throw await toProfileError(response);
  return AccountErasureSchema.parse(await response.json());
}

/**
 * `fetch` rejette sur un échec réseau, et aussi quand le navigateur bloque la
 * réponse pour cause d'origine non autorisée. Les deux méritent d'être dits :
 * confondus avec un refus de l'API, ils donnent un message qui n'apprend rien.
 */
async function send(
  input: string,
  init: RequestInit,
  unreachable: () => Error,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (caught: unknown) {
    // AbortError vient de nous : il remonte tel quel.
    if (caught instanceof DOMException && caught.name === "AbortError") throw caught;
    console.error("appel à l'API impossible", caught);
    throw unreachable();
  }
}

async function toProfileError(response: Response): Promise<ProfileError> {
  if (response.status === 401) return new ProfileError("unauthenticated");

  const body: unknown = await response.json().catch(() => null);
  const code =
    body && typeof body === "object" && "code" in body
      ? ((body as ProfileErrorBody).code ?? "unknown")
      : "unknown";

  return new ProfileError(code);
}
