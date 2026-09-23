import {
  ChronicleSchema,
  DepartureOutcomeSchema,
  StoriesSchema,
  StorySchema,
  TravellersSchema,
  type DepartureOutcome,
  type Stories,
  type StoriesErrorBody,
  type Chronicle,
  type ChronicleDecisions,
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

/*
  Ouvrir un monde aux visiteurs, ou le refermer. Fermé par défaut : un monde
  appartient à son créateur tant qu'il n'a pas dit le contraire.
*/
export async function setStoryOpenness(
  id: string,
  open: boolean,
  signal?: AbortSignal,
): Promise<Story> {
  const response = await fetch(`${API_BASE_URL}/stories/${id}/open`, {
    method: "PUT",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ open }),
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

/*
  La chronique des voyageurs : ce que les visites ont laissé dans ce monde, et
  que son créateur n'a pas encore tranché.
*/
export async function fetchChronicle(
  id: string,
  signal?: AbortSignal,
): Promise<Chronicle> {
  const response = await fetch(`${API_BASE_URL}/stories/${id}/chronicle`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (!response.ok) throw await toStoriesError(response);
  return ChronicleSchema.parse(await response.json());
}

/*
  Ce que l'hôte accepte, et ce qu'il refuse. Accepter recopie dans son monde :
  au moment où la matière passe, c'est lui qui écrit, chez lui.
*/
export async function decideChronicle(
  id: string,
  decisions: ChronicleDecisions["decisions"],
  signal?: AbortSignal,
): Promise<Chronicle> {
  const response = await fetch(`${API_BASE_URL}/stories/${id}/chronicle`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ decisions }),
    signal,
  });

  if (!response.ok) throw await toStoriesError(response);
  return ChronicleSchema.parse(await response.json());
}
