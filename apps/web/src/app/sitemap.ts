import type { MetadataRoute } from "next";

import { routing, type Pathname } from "@/i18n/routing";
import { urlFor } from "@/lib/seo";

/**
 * Chemins internes publics. Chaque entrée est déclinée par locale avec les
 * alternates hreflang des autres ; `urlFor` applique la traduction en URL
 * localisée, donc /en/universes et non /en/univers.
 *
 * Toute nouvelle route publique doit être ajoutée ici.
 *
 * Pas de `lastModified` : une date recalculée à chaque build est un signal
 * faux, et pire qu'une absence de date pour un crawler.
 */
const PATHS: { href: Pathname; priority: number }[] = [
  { href: "/", priority: 1 },
  { href: "/concept", priority: 0.8 },
  { href: "/univers", priority: 0.8 },
  { href: "/multivers", priority: 0.8 },
  { href: "/lore", priority: 0.8 },
  { href: "/glossaire", priority: 0.5 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.flatMap(({ href, priority }) =>
    routing.locales.map((locale) => ({
      url: urlFor(locale, href),
      priority,
      changeFrequency: "weekly" as const,
      alternates: {
        languages: Object.fromEntries(
          routing.locales.map((l) => [l, urlFor(l, href)]),
        ),
      },
    })),
  );
}
