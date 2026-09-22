import {
  BillingCatalogSchema,
  BillingRedirectSchema,
  BillingSummarySchema,
  type BillingCatalog,
  type BillingSummary,
} from "@odyssai/schemas";

import { API_BASE_URL } from "./api";

export class BillingError extends Error {
  readonly code:
    | "billing_disabled"
    | "unauthenticated"
    | "unreachable"
    | "unknown";

  constructor(code: BillingError["code"]) {
    super(code);
    this.name = "BillingError";
    this.code = code;
  }
}

export async function fetchBillingSummary(
  signal?: AbortSignal,
): Promise<BillingSummary> {
  const response = await send(`${API_BASE_URL}/billing`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    // Une reponse en cache montrerait un solde perime juste apres un tour.
    cache: "no-store",
    signal,
  });

  if (!response.ok) throw await toBillingError(response);
  return BillingSummarySchema.parse(await response.json());
}

// Le catalogue est public : il se lit sans session, avant même de s'inscrire.
export async function fetchCatalog(signal?: AbortSignal): Promise<BillingCatalog> {
  const response = await send(`${API_BASE_URL}/billing/catalog`, {
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) throw await toBillingError(response);
  return BillingCatalogSchema.parse(await response.json());
}

/*
  Rend l'URL de paiement, que l'appelant doit suivre par une navigation de
  premier niveau : la page de Stripe refuse d'être chargée en second plan, et
  c'est elle, jamais nous, qui reçoit le numéro de carte.
*/
export async function startCheckout(plan: string): Promise<string> {
  return redirect(`${API_BASE_URL}/billing/checkout`, JSON.stringify({ plan }));
}

// Le portail de Stripe : moyen de paiement, factures, résiliation.
export async function openPortal(): Promise<string> {
  return redirect(`${API_BASE_URL}/billing/portal`);
}

async function redirect(url: string, body?: string): Promise<string> {
  const response = await send(url, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body,
  });

  if (!response.ok) throw await toBillingError(response);
  return BillingRedirectSchema.parse(await response.json()).url;
}

async function send(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (caught: unknown) {
    if (caught instanceof DOMException && caught.name === "AbortError") throw caught;
    console.error("appel à l'API impossible", caught);
    throw new BillingError("unreachable");
  }
}

async function toBillingError(response: Response): Promise<BillingError> {
  if (response.status === 401) return new BillingError("unauthenticated");

  const body: unknown = await response.json().catch(() => null);
  const code =
    body && typeof body === "object" && "code" in body ? body.code : null;

  return new BillingError(code === "billing_disabled" ? code : "unknown");
}

/*
  Le refus pour réserve vide, quel que soit l'appel qui l'a rencontré : le
  tour, la conversation de personnage et la génération de monde le rendent
  tous sous le même code, chacun dans sa propre classe d'erreur.
*/
export function isOutOfCredits(caught: unknown): boolean {
  return (
    caught instanceof Error &&
    "code" in caught &&
    (caught as { code?: unknown }).code === "out_of_credits"
  );
}
