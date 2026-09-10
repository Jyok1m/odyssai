import type { MetadataRoute } from "next";

import { BRAND_INK, SITE_NAME } from "@/lib/site";
import { routing } from "@/i18n/routing";
import fr from "../../messages/fr.json";

/**
 * Le manifeste est servi sur une URL unique, hors du segment [locale] : il ne
 * peut donc pas être localisé par requête. On prend la locale par défaut, et
 * les messages sont importés directement — `next/root-params`, dont dépend
 * notre config next-intl, n'est pas utilisable dans un route handler.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: fr.Metadata.title,
    short_name: SITE_NAME,
    description: fr.Metadata.description,
    lang: routing.defaultLocale,
    start_url: `/${routing.defaultLocale}`,
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: BRAND_INK,
    theme_color: BRAND_INK,
    categories: ["games", "entertainment"],
    icons: [
      {
        src: "/odyssai-mark.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
