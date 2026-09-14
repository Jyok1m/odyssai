"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import {
  isBannerOpen,
  isBannerOpenOnServer,
  recordConsent,
  subscribeConsent,
} from "@/lib/consent";

/**
 * Bandeau de choix sur les cookies.
 *
 * Il ne s'affiche qu'après montage : le choix vit dans un cookie lisible côté
 * navigateur, et le rendre au prérendu figerait un bandeau visible dans des
 * pages statiques servies à tout le monde, y compris à qui a déjà répondu.
 *
 * Les deux réponses ont le même poids visuel. Un refus grisé ou relégué en
 * lien discret vicie le consentement, et la CNIL le sanctionne comme tel.
 *
 * Rien n'est déposé avant la réponse, et aucun outil de mesure n'est branché
 * aujourd'hui : le choix est enregistré pour le jour où il y en aura un.
 */
export function CookieBanner() {
  const t = useTranslations("CookieBanner");
  const open = useSyncExternalStore(
    subscribeConsent,
    isBannerOpen,
    isBannerOpenOnServer,
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-banner-title"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4 sm:px-6 sm:pb-6"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4 rounded-card border border-line bg-abyss p-5 shadow-lg sm:flex-row sm:items-center sm:gap-6">
        <div className="min-w-0 flex-1">
          <p id="cookie-banner-title" className="text-ui-sm text-vellum">
            {t("body")}
          </p>
          <Link
            href="/cookies"
            className="mt-1 inline-block text-caption text-vellum-3 underline transition-colors hover:text-vellum"
          >
            {t("learnMore")}
          </Link>
        </div>

        {/* Ordre inversé au clavier et à l'écran : « accepter » est l'action
            positive, elle reste à droite, mais les deux gardent la même taille
            et le même contraste. */}
        <div className="flex shrink-0 gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => recordConsent(false)}
          >
            {t("decline")}
          </Button>
          <Button type="button" size="sm" onClick={() => recordConsent(true)}>
            {t("accept")}
          </Button>
        </div>
      </div>
    </div>
  );
}
