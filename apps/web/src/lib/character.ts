import {
  CharacterConversationSchema,
  CharacterExtractResponseSchema,
  CharacterStreamEventSchema,
  type CharacterConversation,
  type CharacterErrorBody,
  type CharacterExtractResponse,
  type CharacterStreamEvent,
} from "@odyssai/schemas";

import { API_BASE_URL } from "./api";
import { readEventStream } from "./sse";

export class CharacterError extends Error {
  readonly code: CharacterErrorBody["code"] | "unauthenticated" | "unknown";

  constructor(code: CharacterError["code"]) {
    super(code);
    this.name = "CharacterError";
    this.code = code;
  }
}

const BASE = `${API_BASE_URL}/onboarding/character`;

export async function fetchConversation(
  signal?: AbortSignal,
): Promise<CharacterConversation> {
  const response = await fetch(BASE, {
    credentials: "include",
    headers: { Accept: "application/json" },
    // Une réponse en cache ferait reprendre une conversation périmée.
    cache: "no-store",
    signal,
  });

  if (!response.ok) throw await toCharacterError(response);
  return CharacterConversationSchema.parse(await response.json());
}

/** Ouvre le flux et rend chaque événement validé. */
export async function sendCharacterMessage(
  content: string,
  onEvent: (event: CharacterStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${BASE}/messages`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
    signal,
  });

  if (!response.ok) throw await toCharacterError(response);
  await readEventStream(response, CharacterStreamEventSchema, onEvent);
}

/** Une proposition, pas un enregistrement : c'est PUT /onboarding qui écrit. */
export async function extractCharacter(
  signal?: AbortSignal,
): Promise<CharacterExtractResponse> {
  const response = await fetch(`${BASE}/extract`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) throw await toCharacterError(response);
  return CharacterExtractResponseSchema.parse(await response.json());
}

async function toCharacterError(response: Response): Promise<CharacterError> {
  if (response.status === 401) return new CharacterError("unauthenticated");

  const body: unknown = await response.json().catch(() => null);
  const code =
    body && typeof body === "object" && "code" in body
      ? ((body as CharacterErrorBody).code ?? "unknown")
      : "unknown";

  return new CharacterError(code);
}
