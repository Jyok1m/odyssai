import { routing } from "@/i18n/routing";

/**
 * À n'importer que depuis du code serveur. `SITE_URL` n'a pas le préfixe
 * NEXT_PUBLIC_, donc elle vaudrait le repli localhost dans un bundle
 * navigateur. Elle ne sert qu'aux métadonnées, au sitemap, à robots.txt et au
 * JSON-LD, tous rendus côté serveur.
 */
export const SITE_URL = (
  process.env.SITE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

/** OpenGraph exige la forme `langue_TERRITOIRE`. */
export const OG_LOCALE = {
  fr: "fr_FR",
  en: "en_US",
} as const satisfies Record<(typeof routing.locales)[number], string>;

/**
 * Canonical + hreflang pour une page donnée. `path` est le chemin **sans**
 * préfixe de locale, tel que le renvoie `usePathname` de next-intl.
 *
 * hreflang reste en code de langue seul : le site ne cible pas de région, et
 * un `fr-FR` inutile exclurait les francophones hors de France.
 */
export function alternatesFor(
  locale: (typeof routing.locales)[number],
  path = "",
) {
  const href = (l: string) => `${SITE_URL}/${l}${path}`;

  return {
    canonical: href(locale),
    languages: {
      ...Object.fromEntries(routing.locales.map((l) => [l, href(l)])),
      // La racine négocie la langue : c'est le bon x-default, et c'est aussi
      // celui que le proxy next-intl annonce en en-tête Link. Les deux
      // doivent concorder, sinon le crawler voit deux x-default.
      "x-default": `${SITE_URL}${path || "/"}`,
    },
  };
}
