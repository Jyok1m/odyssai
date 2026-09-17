import {
  PlayerProfile,
  UpdateProfileRequestSchema,
  type ProfileErrorBody,
} from "@odyssai/schemas";

import { API_BASE_URL } from "./api";

/** Refus de l'API sur le profil. `username_taken` est le seul cas métier. */
export class ProfileError extends Error {
  readonly code: ProfileErrorBody["code"] | "unauthenticated" | "unknown";

  constructor(code: ProfileError["code"]) {
    super(code);
    this.name = "ProfileError";
    this.code = code;
  }
}

export async function fetchProfile(signal?: AbortSignal): Promise<PlayerProfile> {
  const response = await fetch(`${API_BASE_URL}/me`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    // Une réponse en cache ferait survivre un pseudo périmé à sa modification.
    cache: "no-store",
    signal,
  });

  if (!response.ok) throw await toProfileError(response);
  return PlayerProfile.parse(await response.json());
}

export async function updateUsername(username: string): Promise<PlayerProfile> {
  // Validé ici aussi : le même schéma que l'API, donc le champ répond avant
  // l'aller-retour et l'API reste seule juge.
  const body = UpdateProfileRequestSchema.parse({ username });

  const response = await fetch(`${API_BASE_URL}/me`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw await toProfileError(response);
  return PlayerProfile.parse(await response.json());
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
