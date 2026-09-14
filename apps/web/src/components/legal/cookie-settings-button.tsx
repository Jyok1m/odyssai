"use client";

import { useTranslations } from "next-intl";

import { openBanner } from "@/lib/consent";

/**
 * Rouvre le bandeau depuis le pied de page. Retirer un consentement doit être
 * aussi simple que le donner : sans ce point d'entrée, le choix serait
 * définitif jusqu'à expiration du cookie.
 */
export function CookieSettingsButton() {
  const t = useTranslations("CookieBanner");

  return (
    <button
      type="button"
      onClick={openBanner}
      className="text-vellum-3 transition-colors hover:text-vellum"
    >
      {t("manage")}
    </button>
  );
}
