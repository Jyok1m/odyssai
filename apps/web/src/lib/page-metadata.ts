import type { Metadata } from "next";

import { routing, type Locale, type Pathname } from "@/i18n/routing";
import { OG_LOCALE, alternatesFor, urlFor } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";

/**
 * Métadonnées d'une page de contenu. Next remplace les clés au lieu de les
 * fusionner en profondeur : `openGraph` doit donc redéclarer son image, sinon
 * celle du layout racine disparaît de la page.
 */
export function pageMetadata({
  locale,
  href,
  title,
  description,
}: {
  locale: Locale;
  href: Pathname;
  title: string;
  description: string;
}): Metadata {
  const image = {
    url: "/og/odyssai-og.png",
    width: 1200,
    height: 630,
    alt: SITE_NAME,
    type: "image/png",
  };

  return {
    title,
    description,
    alternates: alternatesFor(locale, href),
    openGraph: {
      type: "article",
      siteName: SITE_NAME,
      url: urlFor(locale, href),
      locale: OG_LOCALE[locale],
      alternateLocale: routing.locales
        .filter((l) => l !== locale)
        .map((l) => OG_LOCALE[l]),
      title,
      description,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image.url],
    },
  };
}
