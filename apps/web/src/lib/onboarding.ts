import {
  DepartureOutcomeSchema,
  OnboardingStateSchema,
  OnboardingUpdateSchema,
  type OnboardingErrorBody,
  type DepartureOutcome,
  type OnboardingState,
  type OnboardingUpdate,
} from "@odyssai/schemas";

import { API_BASE_URL } from "./api";

/**
 * Refus de l'API sur le parcours. `incomplete` n'est pas une panne : la saisie
 * est bien enregistrée, c'est le passage à l'étape suivante qui est refusé.
 */
export class OnboardingError extends Error {
  readonly code:
    | OnboardingErrorBody["code"]
    | "unauthenticated"
    /** L'API n'a pas répondu : réseau coupé, ou origine refusée. */
    | "unreachable"
    | "unknown";

  constructor(code: OnboardingError["code"]) {
    super(code);
    this.name = "OnboardingError";
    this.code = code;
  }
}

export async function fetchOnboarding(
  signal?: AbortSignal,
): Promise<OnboardingState> {
  const response = await send(`${API_BASE_URL}/onboarding`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    // Une réponse en cache ferait reprendre le joueur à une étape périmée.
    cache: "no-store",
    signal,
  }, () => new OnboardingError("unreachable"));

  if (!response.ok) throw await toOnboardingError(response);
  return OnboardingStateSchema.parse(await response.json());
}

export async function saveOnboarding(
  update: OnboardingUpdate,
  signal?: AbortSignal,
): Promise<OnboardingState> {
  // Validé ici aussi : le même schéma que l'API, donc l'écran répond avant
  // l'aller-retour et l'API reste seule juge.
  const body = OnboardingUpdateSchema.parse(update);

  const response = await send(`${API_BASE_URL}/onboarding`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal,
  }, () => new OnboardingError("unreachable"));

  if (!response.ok) throw await toOnboardingError(response);
  return OnboardingStateSchema.parse(await response.json());
}

/**
 * `fetch` rejette sur un échec réseau, et aussi quand le navigateur bloque la
 * réponse pour cause d'origine non autorisée. Les deux méritent d'être dits :
 * confondus avec un refus de l'API, ils donnent un message qui n'apprend rien.
 */
async function send(
  input: string,
  init: RequestInit,
  unreachable: () => Error,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (caught: unknown) {
    // AbortError vient de nous : il remonte tel quel.
    if (caught instanceof DOMException && caught.name === "AbortError") throw caught;
    console.error("appel à l'API impossible", caught);
    throw unreachable();
  }
}

/**
 * Recommencer. Le monde et le personnage sont traités selon la règle du
 * départ, et le joueur repart à l'inspiration.
 */
export async function restartOnboarding(
  signal?: AbortSignal,
): Promise<DepartureOutcome> {
  const response = await send(
    `${API_BASE_URL}/onboarding`,
    { method: "DELETE", credentials: "include", signal },
    () => new OnboardingError("unreachable"),
  );

  if (!response.ok) throw await toOnboardingError(response);
  return DepartureOutcomeSchema.parse(await response.json());
}

async function toOnboardingError(response: Response): Promise<OnboardingError> {
  if (response.status === 401) return new OnboardingError("unauthenticated");

  const body: unknown = await response.json().catch(() => null);
  const code =
    body && typeof body === "object" && "code" in body
      ? ((body as OnboardingErrorBody).code ?? "unknown")
      : "unknown";

  return new OnboardingError(code);
}
