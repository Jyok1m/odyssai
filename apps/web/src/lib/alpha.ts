import {
  AlphaStatusSchema,
  type AlphaStatus,
  type UpdateAlphaRequest,
} from "@odyssai/schemas";

import { API_BASE_URL } from "./api";

/*
  L'état de l'alpha, public et sans session : le bandeau doit pouvoir
  s'afficher avant que qui que ce soit se connecte.
*/
export async function fetchAlphaStatus(
  signal?: AbortSignal,
): Promise<AlphaStatus> {
  const response = await fetch(`${API_BASE_URL}/alpha`, {
    headers: { Accept: "application/json" },
    // Le compte des places bouge à chaque inscription : une réponse en cache
    // annoncerait des places déjà prises.
    cache: "no-store",
    signal,
  });

  if (!response.ok) throw new Error(`GET /alpha a répondu ${response.status}`);

  return AlphaStatusSchema.parse(await response.json());
}

// Lecture et écriture réservées au tableau de bord, derrière les deux gardes.
export async function fetchAdminAlpha(
  signal?: AbortSignal,
): Promise<AlphaStatus> {
  const response = await fetch(`${API_BASE_URL}/admin/alpha`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (!response.ok) throw new Error(`GET /admin/alpha a répondu ${response.status}`);

  return AlphaStatusSchema.parse(await response.json());
}

export async function updateAlpha(
  request: UpdateAlphaRequest,
): Promise<AlphaStatus> {
  const response = await fetch(`${API_BASE_URL}/admin/alpha`, {
    method: "PATCH",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) throw new Error(`PATCH /admin/alpha a répondu ${response.status}`);

  return AlphaStatusSchema.parse(await response.json());
}
