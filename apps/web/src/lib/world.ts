import {
  GenerationStreamEventSchema,
  WorldViewSchema,
  type GenerationStreamEvent,
  type WorldErrorBody,
  type WorldView,
} from "@odyssai/schemas";

import { API_BASE_URL } from "./api";
import { readEventStream } from "./sse";

export class WorldError extends Error {
  readonly code: WorldErrorBody["code"] | "unauthenticated" | "unknown";

  constructor(code: WorldError["code"]) {
    super(code);
    this.name = "WorldError";
    this.code = code;
  }
}

/*
  Suit l'avancement jusqu'à la fin du flux. L'API le ferme d'elle-même au bout
  de dix minutes : l'appelant rouvre s'il n'a pas eu de conclusion.
*/
export async function watchGeneration(
  onEvent: (event: GenerationStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/onboarding/generation`, {
    credentials: "include",
    headers: { Accept: "text/event-stream" },
    cache: "no-store",
    signal,
  });

  if (!response.ok) throw new WorldError("unknown");
  await readEventStream(response, GenerationStreamEventSchema, onEvent);
}

export async function fetchWorld(signal?: AbortSignal): Promise<WorldView> {
  const response = await fetch(`${API_BASE_URL}/world`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    // Une réponse en cache ferait survivre un monde périmé à sa régénération.
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    if (response.status === 401) throw new WorldError("unauthenticated");

    const body: unknown = await response.json().catch(() => null);
    const code =
      body && typeof body === "object" && "code" in body
        ? ((body as WorldErrorBody).code ?? "unknown")
        : "unknown";
    throw new WorldError(code);
  }

  return WorldViewSchema.parse(await response.json());
}
