import {
  DepartureOutcomeSchema,
  PartySchema,
  type DepartureOutcome,
  type Party,
  type PartyErrorBody,
} from "@odyssai/schemas";

import { API_BASE_URL } from "./api";

export class PartyError extends Error {
  readonly code: PartyErrorBody["code"] | "unauthenticated" | "unknown";

  constructor(code: PartyError["code"]) {
    super(code);
    this.name = "PartyError";
    this.code = code;
  }
}

/*
  Ouvrir une table : l'histoire naît vide, à l'inspiration, et chacun la
  remplit de sa part. Le code d'invitation se partage hors bande.
*/
export async function createParty(
  size: number,
  signal?: AbortSignal,
): Promise<Party> {
  const response = await fetch(`${API_BASE_URL}/parties`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ size }),
    signal,
  });

  if (!response.ok) throw await toPartyError(response);
  return PartySchema.parse(await response.json());
}

// S'asseoir à une table, par son code.
export async function joinParty(
  code: string,
  signal?: AbortSignal,
): Promise<Party> {
  const response = await fetch(`${API_BASE_URL}/parties/join`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ code }),
    signal,
  });

  if (!response.ok) throw await toPartyError(response);
  return PartySchema.parse(await response.json());
}

/*
  Quitter sa table. Le monde y survit si d'autres y jouent, et le personnage
  du partant prend sa tombe : le groupe l'a croisé.
*/
export async function leaveParty(
  signal?: AbortSignal,
): Promise<DepartureOutcome> {
  const response = await fetch(`${API_BASE_URL}/parties/me`, {
    method: "DELETE",
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) throw await toPartyError(response);
  return DepartureOutcomeSchema.parse(await response.json());
}

async function toPartyError(response: Response): Promise<PartyError> {
  if (response.status === 401) return new PartyError("unauthenticated");

  const body: unknown = await response.json().catch(() => null);
  const known = body && typeof body === "object" && "code" in body;

  return new PartyError(
    known ? ((body as PartyErrorBody).code ?? "unknown") : "unknown",
  );
}
