import {
  TurnHistorySchema,
  TurnStreamEventSchema,
  type TurnErrorBody,
  type TurnHistory,
  type TurnRequest,
  type TurnStreamEvent,
} from "@odyssai/schemas";

import { API_BASE_URL } from "./api";
import { readEventStream } from "./sse";

export class TurnError extends Error {
  readonly code: TurnErrorBody["code"] | "unauthenticated" | "unreachable" | "unknown";
  readonly retryAfterSeconds?: number;

  constructor(code: TurnError["code"], retryAfterSeconds?: number) {
    super(code);
    this.name = "TurnError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function send(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (caught: unknown) {
    if (caught instanceof DOMException && caught.name === "AbortError") throw caught;
    console.error("appel à l'API impossible", caught);
    throw new TurnError("unreachable");
  }
}

export async function fetchHistory(signal?: AbortSignal): Promise<TurnHistory> {
  const response = await send(`${API_BASE_URL}/turn`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    // Une réponse en cache ferait reprendre la partie à un tour périmé.
    cache: "no-store",
    signal,
  });

  if (!response.ok) throw await toTurnError(response);
  return TurnHistorySchema.parse(await response.json());
}

/**
 * Joue un tour. Le flux porte le récit, puis une conclusion qui dit si le sort
 * a penché, et seulement quand il a servi.
 */
export async function playTurn(
  request: TurnRequest,
  onEvent: (event: TurnStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await send(`${API_BASE_URL}/turn`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) throw await toTurnError(response);
  await readEventStream(response, TurnStreamEventSchema, onEvent);
}

async function toTurnError(response: Response): Promise<TurnError> {
  if (response.status === 401) return new TurnError("unauthenticated");

  const body: unknown = await response.json().catch(() => null);
  const known = body && typeof body === "object" && "code" in body;

  return new TurnError(
    known ? ((body as TurnErrorBody).code ?? "unknown") : "unknown",
    known ? (body as TurnErrorBody).retryAfterSeconds : undefined,
  );
}
