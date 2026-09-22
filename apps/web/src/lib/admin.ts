import {
  AdminOverviewSchema,
  AdminPlanSchema,
  AdminUserDetailSchema,
  AdminMarketingListSchema,
  AdminUserPageSchema,
  type AdjustCreditsRequest,
  type AdminOverview,
  type AdminPlan,
  type AdminUserDetail,
  type AdminMarketingList,
  type AdminUserPage,
  type CreatePlanRequest,
  type UpdatePlanRequest,
} from "@odyssai/schemas";

import { API_BASE_URL } from "./api";

/*
  Ce que ce module attend d'un schéma, et rien de plus.

  Zod n'est pas une dépendance de `apps/web` : les schémas arrivent tout
  construits depuis `@odyssai/schemas`, et les typer structurellement évite
  d'ajouter le paquet ici juste pour nommer `z.ZodType`.
*/
interface Parser<T> {
  parse(input: unknown): T;
}

/*
  Client du tableau de bord.

  Tout passe derrière `AdminGuard` : un 403 ici n'est pas une panne, c'est la
  réponse normale à quelqu'un qui n'a pas le droit, et l'écran le dit.
*/
export class AdminError extends Error {
  readonly code:
    | "forbidden"
    | "not_found"
    | "slug_taken"
    | "plan_in_use"
    | "plan_protected"
    | "billing_disabled"
    | "stripe_error"
    | "validation_error"
    | "unauthenticated"
    | "unreachable"
    | "unknown";

  // Ce que l'API a joint au refus, par exemple le nombre d'abonnés.
  readonly detail?: string;

  constructor(code: AdminError["code"], detail?: string) {
    super(code);
    this.name = "AdminError";
    this.code = code;
    this.detail = detail;
  }
}

export async function fetchOverview(signal?: AbortSignal): Promise<AdminOverview> {
  return read(`${API_BASE_URL}/admin/overview`, AdminOverviewSchema, signal);
}

export async function fetchUsers(
  query: { search?: string; plan?: string; cursor?: string; optIn?: boolean },
  signal?: AbortSignal,
): Promise<AdminUserPage> {
  const url = new URL(`${API_BASE_URL}/admin/users`);
  if (query.search) url.searchParams.set("search", query.search);
  if (query.plan) url.searchParams.set("plan", query.plan);
  if (query.cursor) url.searchParams.set("cursor", query.cursor);
  // Seulement quand il est vrai : le parametre ne sait pas dire « ceux qui ont
  // refuse », et l'API ne l'entendrait pas non plus.
  if (query.optIn) url.searchParams.set("optIn", "true");

  return read(url.toString(), AdminUserPageSchema, signal);
}

// Les adresses de ceux qui ont consenti, et rien d'autre.
export async function fetchMarketingEmails(
  signal?: AbortSignal,
): Promise<AdminMarketingList> {
  return read(
    `${API_BASE_URL}/admin/marketing/emails`,
    AdminMarketingListSchema,
    signal,
  );
}

export async function fetchUser(
  id: string,
  signal?: AbortSignal,
): Promise<AdminUserDetail> {
  return read(`${API_BASE_URL}/admin/users/${id}`, AdminUserDetailSchema, signal);
}

export async function adjustCredits(
  id: string,
  request: AdjustCreditsRequest,
): Promise<AdminUserDetail> {
  return write(
    `${API_BASE_URL}/admin/users/${id}/credits`,
    "POST",
    AdminUserDetailSchema,
    request,
  );
}

// Résilie chez Stripe. Le retour au palier libre viendra du webhook.
export async function cancelSubscription(id: string): Promise<void> {
  await send(`${API_BASE_URL}/admin/users/${id}/subscription`, {
    method: "DELETE",
    credentials: "include",
  });
}

export async function fetchPlans(signal?: AbortSignal): Promise<AdminPlan[]> {
  return read(`${API_BASE_URL}/admin/plans`, AdminPlanSchema.array(), signal);
}

export async function createPlan(request: CreatePlanRequest): Promise<AdminPlan> {
  return write(`${API_BASE_URL}/admin/plans`, "POST", AdminPlanSchema, request);
}

export async function updatePlan(
  id: string,
  request: UpdatePlanRequest,
): Promise<AdminPlan> {
  return write(`${API_BASE_URL}/admin/plans/${id}`, "PATCH", AdminPlanSchema, request);
}

export async function removePlan(id: string): Promise<void> {
  await send(`${API_BASE_URL}/admin/plans/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
}

async function read<T>(
  url: string,
  schema: Parser<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await send(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    // Un solde en cache mentirait juste après l'avoir modifié.
    cache: "no-store",
    signal,
  });

  return schema.parse(await response.json());
}

async function write<T>(
  url: string,
  method: "POST" | "PATCH",
  schema: Parser<T>,
  body: unknown,
): Promise<T> {
  const response = await send(url, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });

  return schema.parse(await response.json());
}

async function send(url: string, init: RequestInit): Promise<Response> {
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch (caught: unknown) {
    if (caught instanceof DOMException && caught.name === "AbortError") throw caught;
    console.error("appel à l'API impossible", caught);
    throw new AdminError("unreachable");
  }

  if (!response.ok) throw await toAdminError(response);
  return response;
}

async function toAdminError(response: Response): Promise<AdminError> {
  if (response.status === 401) return new AdminError("unauthenticated");

  const body: unknown = await response.json().catch(() => null);
  const known =
    body && typeof body === "object" && "code" in body
      ? (body as { code: string; message?: string })
      : null;

  const code = (known?.code ?? "unknown") as AdminError["code"];
  return new AdminError(code, known?.message);
}
