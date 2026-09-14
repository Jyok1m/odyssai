/**
 * Choix de l'utilisateur sur les cookies non essentiels.
 *
 * Stocké dans un cookie et non dans localStorage : c'est lui-même une preuve
 * de consentement, il doit donc survivre à un nettoyage de stockage et rester
 * lisible côté serveur le jour où une décision de rendu en dépendra.
 *
 * Six mois de durée de vie, la durée recommandée par la CNIL au-delà de
 * laquelle le choix doit être redemandé. `version` permet de le redemander
 * plus tôt si une nouvelle finalité apparaît : un consentement donné pour
 * une mesure d'audience ne vaut pas pour une régie publicitaire.
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
    // Un choix rendu pour une version antérieure ne vaut plus : on le traite
    // comme absent, ce qui fait réapparaître la bannière.
    if (parsed.version !== CONSENT_VERSION) return null;
    return { version: CONSENT_VERSION, analytics: parsed.analytics === true };
  } catch {
    return null;
  }
}

export function writeConsent(analytics: boolean): Consent {
  const consent: Consent = { version: CONSENT_VERSION, analytics };
  const value = encodeURIComponent(JSON.stringify(consent));

  // SameSite=Lax et pas Strict : le retour depuis Keycloak est une navigation
  // venue d'un autre site, et le choix ne doit pas disparaître au passage.
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

/* ------------------------------------------------------------------ magasin

   Le cookie est un système extérieur à React : on l'expose en magasin plutôt
   qu'en état local, pour que le bandeau s'y abonne par useSyncExternalStore.
   Écrire le choix dans un effet reviendrait à faire un rendu en cascade, et
   deux composants montés en même temps se désynchroniseraient. */

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

/** Rouvre le bandeau. Retirer son choix doit être aussi simple que le donner. */
export function openBanner(): void {
  forcedOpen = true;
  emit();
}

export function recordConsent(analytics: boolean): void {
  writeConsent(analytics);
  forcedOpen = false;
  emit();
}
