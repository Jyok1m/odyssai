/**
 * Choix sur les cookies non essentiels, dans un cookie et non dans
 * localStorage : c'est une preuve de consentement, elle doit rester lisible
 * côté serveur. Six mois, la durée au-delà de laquelle la CNIL veut que le
 * choix soit redemandé ; `version` permet de le redemander plus tôt.
 */
export const CONSENT_COOKIE = "odyssai_consent";
export const CONSENT_VERSION = 1;
const SIX_MONTHS_SECONDS = 60 * 60 * 24 * 182;

export type Consent = {
  version: number;
  /** Mesure d'audience. Aucun outil branché aujourd'hui. */
  analytics: boolean;
};

export function readConsent(): Consent | null {
  if (typeof document === "undefined") return null;

  const raw = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${CONSENT_COOKIE}=`))
    ?.slice(CONSENT_COOKIE.length + 1);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<Consent>;
    // Une version antérieure vaut absence : la bannière réapparaît.
    if (parsed.version !== CONSENT_VERSION) return null;
    return { version: CONSENT_VERSION, analytics: parsed.analytics === true };
  } catch {
    return null;
  }
}

export function writeConsent(analytics: boolean): Consent {
  const consent: Consent = { version: CONSENT_VERSION, analytics };
  const value = encodeURIComponent(JSON.stringify(consent));

  // Lax et non Strict : le retour depuis Keycloak vient d'un autre site.
  document.cookie = [
    `${CONSENT_COOKIE}=${value}`,
    "path=/",
    `max-age=${SIX_MONTHS_SECONDS}`,
    "SameSite=Lax",
    window.location.protocol === "https:" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

  return consent;
}

/* Le cookie est un système extérieur à React, exposé en magasin pour que le
   bandeau s'y abonne par useSyncExternalStore : un effet ferait un rendu en
   cascade, et deux composants montés ensemble divergeraient. */

const listeners = new Set<() => void>();
let forcedOpen = false;

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Un booléen et non un objet : useSyncExternalStore compare par identité. */
export function isBannerOpen(): boolean {
  return forcedOpen || readConsent() === null;
}

/** Au rendu serveur, aucun cookie n'est lisible : le bandeau reste fermé. */
export function isBannerOpenOnServer(): boolean {
  return false;
}

export function openBanner(): void {
  forcedOpen = true;
  emit();
}

export function recordConsent(analytics: boolean): void {
  writeConsent(analytics);
  forcedOpen = false;
  emit();
}
