import type { MetadataRoute } from "next";

import { routing, type Pathname } from "@/i18n/routing";
import { urlFor } from "@/lib/seo";

/**
 * Chemins internes publics, déclinés par locale avec les hreflang des autres.
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
  // Une page de tarifs se cherche par son nom : elle merite la meme priorite
  // que les pages de contenu, pas celle des mentions legales.
  { href: "/tarifs", priority: 0.8 },
  { href: "/glossaire", priority: 0.5 },
  // Faible priorite, mais presentes : elles sont obligatoires.
  { href: "/conditions", priority: 0.3 },
  { href: "/mentions-legales", priority: 0.2 },
  { href: "/confidentialite", priority: 0.2 },
  { href: "/cookies", priority: 0.2 },
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
