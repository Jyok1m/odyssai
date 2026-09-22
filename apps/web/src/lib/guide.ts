import {
  GuideStreamEventSchema,
  GuideSuggestionsResponseSchema,
  type GuideErrorBody,
  type GuideStreamEvent,
  type GuideSuggestionsResponse,
  type UiLocale,
} from "@odyssai/schemas";

import { API_BASE_URL } from "./api";
import { readEventStream } from "./sse";

// Clé de test Cloudflare, qui accepte tout : elle ne vaut que pour le dev.
const TEST_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? TEST_SITE_KEY;

// Refus rendu avant l'ouverture du flux. Le code vient de l'API.
export class GuideRequestError extends Error {
  readonly code: GuideErrorBody["code"] | "unknown";
  readonly retryAfterSeconds?: number;

  constructor(code: GuideRequestError["code"], retryAfterSeconds?: number) {
    super(code);
    this.name = "GuideRequestError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function fetchSuggestions(
  locale: UiLocale,
  signal?: AbortSignal,
): Promise<GuideSuggestionsResponse> {
  const response = await fetch(
    `${API_BASE_URL}/guide/suggestions?locale=${locale}`,
    { headers: { Accept: "application/json" }, signal },
  );
  if (!response.ok) throw new Error(`suggestions : HTTP ${response.status}`);
  return GuideSuggestionsResponseSchema.parse(await response.json());
}

export async function requestGuidePass(turnstileToken: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/guide/pass`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turnstileToken }),
  });

  if (!response.ok) throw await toRequestError(response);
}

// Ouvre le flux et rend chaque événement validé.
export async function askGuide(
  body: { question: string; locale: UiLocale },
  onEvent: (event: GuideStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/guide/ask`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) throw await toRequestError(response);
  if (!response.body) throw new GuideRequestError("unknown");

  await readEventStream(response, GuideStreamEventSchema, onEvent);
}

async function toRequestError(response: Response): Promise<GuideRequestError> {
  const body: unknown = await response.json().catch(() => null);
  const code =
    body && typeof body === "object" && "code" in body
      ? ((body as GuideErrorBody).code ?? "unknown")
      : "unknown";
  const retryAfterSeconds =
    body && typeof body === "object" && "retryAfterSeconds" in body
      ? (body as GuideErrorBody).retryAfterSeconds
      : undefined;

  return new GuideRequestError(code, retryAfterSeconds);
}


interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance?: "always" | "execute" | "interaction-only";
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
}

function turnstile(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

let scriptPromise: Promise<void> | undefined;

/*
  Chargé au premier refus seulement, jamais au chargement de la page : une
  question servie par la FAQ ne doit coûter aucun script tiers au visiteur.
*/
function loadTurnstileScript(): Promise<void> {
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    if (turnstile()) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = undefined;
      reject(new GuideRequestError("pass_unavailable"));
    };
    document.head.append(script);
  });

  return scriptPromise;
}

export async function solveTurnstile(container: HTMLElement): Promise<string> {
  await loadTurnstileScript();
  const api = turnstile();
  if (!api) throw new GuideRequestError("pass_unavailable");

  return new Promise<string>((resolve, reject) => {
    const widgetId = api.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      // Le défi ne s'affiche que s'il faut vraiment interagir.
      appearance: "interaction-only",
      callback: (token) => {
        api.remove(widgetId);
        resolve(token);
      },
      "error-callback": () => {
        api.remove(widgetId);
        reject(new GuideRequestError("pass_unavailable"));
      },
      "expired-callback": () => {
        api.remove(widgetId);
        reject(new GuideRequestError("pass_required"));
      },
    });
  });
}
