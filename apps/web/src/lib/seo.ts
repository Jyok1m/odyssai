import { getPathname } from "@/i18n/navigation";
import { routing, type Locale, type Pathname } from "@/i18n/routing";

/**
 * À n'importer que depuis du code serveur : sans préfixe NEXT_PUBLIC_, cette
 * variable vaudrait le repli localhost dans un bundle navigateur.
 */
export const SITE_URL = (
  process.env.SITE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

/** OpenGraph exige la forme `langue_TERRITOIRE`. */
export const OG_LOCALE = {
  fr: "fr_FR",
  en: "en_US",
} as const satisfies Record<Locale, string>;

/** URL absolue de la page, chemin localisé et préfixe de locale compris. */
export function urlFor(locale: Locale, href: Pathname = "/") {
  return `${SITE_URL}${getPathname({ locale, href })}`;
}

/**
 * Canonical et hreflang. `href` est le chemin interne, celui du dossier sous
 * app/[locale] ; next-intl le traduit en chemin public.
 *
 * hreflang reste en code de langue seul : le site ne cible pas de région, et un
 * `fr-FR` inutile exclurait les francophones hors de France.
 */
export function alternatesFor(locale: Locale, href: Pathname = "/") {
  // Sans préfixe de locale : c'est ce que le proxy next-intl annonce en
  // x-default dans son en-tête Link, et les deux doivent concorder.
  const unprefixed =
    getPathname({ locale: routing.defaultLocale, href }).replace(
      `/${routing.defaultLocale}`,
      "",
    ) || "/";

  return {
    canonical: urlFor(locale, href),
    languages: {
      ...Object.fromEntries(routing.locales.map((l) => [l, urlFor(l, href)])),
      "x-default": `${SITE_URL}${unprefixed}`,
    },
  };
}
