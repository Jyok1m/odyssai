import {
  DepartureOutcomeSchema,
  StoriesSchema,
  StorySchema,
  TravellersSchema,
  type DepartureOutcome,
  type Stories,
  type StoriesErrorBody,
  type Story,
  type Travellers,
} from "@odyssai/schemas";

import { API_BASE_URL } from "./api";

export class StoriesError extends Error {
  readonly code: StoriesErrorBody["code"] | "unauthenticated" | "unknown";

  constructor(code: StoriesError["code"]) {
    super(code);
    this.name = "StoriesError";
    this.code = code;
  }
}

export async function fetchStories(signal?: AbortSignal): Promise<Stories> {
  const response = await fetch(`${API_BASE_URL}/stories`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (!response.ok) throw await toStoriesError(response);
  return StoriesSchema.parse(await response.json());
}

// Les personnages du joueur, et les mondes où on les retrouve.
export async function fetchTravellers(signal?: AbortSignal): Promise<Travellers> {
  const response = await fetch(`${API_BASE_URL}/stories/travellers`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (!response.ok) throw await toStoriesError(response);
  return TravellersSchema.parse(await response.json());
}

/*
  Une histoire neuve, ouverte aussitôt : le parcours repart à l'inspiration.

  Avec une essence, le personnage arrive déjà écrit : le parcours saute la
  conversation de création et ouvre directement sa fiche.
*/
export async function startStory(
  essenceId?: string,
  signal?: AbortSignal,
): Promise<Story> {
  const response = await fetch(`${API_BASE_URL}/stories`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(essenceId ? { essenceId } : {}),
    signal,
  });

  if (!response.ok) throw await toStoriesError(response);
  return StorySchema.parse(await response.json());
}

export async function selectStory(id: string, signal?: AbortSignal): Promise<Story> {
  const response = await fetch(`${API_BASE_URL}/stories/${id}/current`, {
    method: "PUT",
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) throw await toStoriesError(response);
  return StorySchema.parse(await response.json());
}

/*
  Supprimer une histoire, ouverte ou non. Son sort est décidé par l'API selon
  ce que d'autres joueurs en ont vu, comme au recommencement.
*/
export async function deleteStory(
  id: string,
  signal?: AbortSignal,
): Promise<DepartureOutcome> {
  const response = await fetch(`${API_BASE_URL}/stories/${id}`, {
    method: "DELETE",
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) throw await toStoriesError(response);
  return DepartureOutcomeSchema.parse(await response.json());
}

async function toStoriesError(response: Response): Promise<StoriesError> {
  if (response.status === 401) return new StoriesError("unauthenticated");

  const body: unknown = await response.json().catch(() => null);
  const code =
    body && typeof body === "object" && "code" in body
      ? ((body as StoriesErrorBody).code ?? "unknown")
      : "unknown";

  return new StoriesError(code);
}
