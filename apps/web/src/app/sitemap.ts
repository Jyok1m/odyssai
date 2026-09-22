import type { MetadataRoute } from "next";

import { routing, type Pathname } from "@/i18n/routing";
import { alternatesFor, urlFor } from "@/lib/seo";

/*
  Chemins internes publics, déclinés par locale avec les hreflang des autres.
  Toute nouvelle route publique doit être ajoutée ici.

  Pas de `lastModified` : une date recalculée à chaque build est un signal
  faux, et pire qu'une absence de date pour un crawler.
*/
const PATHS: { href: Pathname; priority: number }[] = [
  { href: "/", priority: 1 },
  { href: "/concept", priority: 0.8 },
  { href: "/universes", priority: 0.8 },
  { href: "/multiverse", priority: 0.8 },
  { href: "/lore", priority: 0.8 },
  // Une page de tarifs se cherche par son nom : elle merite la meme priorite
  // que les pages de contenu, pas celle des mentions legales.
  { href: "/pricing", priority: 0.8 },
  { href: "/glossary", priority: 0.5 },
  { href: "/about", priority: 0.6 },
  // Faible priorite, mais presentes : elles sont obligatoires.
  { href: "/terms", priority: 0.3 },
  { href: "/contact", priority: 0.4 },
  { href: "/legal-notice", priority: 0.2 },
  { href: "/privacy", priority: 0.2 },
  { href: "/cookies", priority: 0.2 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.flatMap(({ href, priority }) =>
    routing.locales.map((locale) => ({
      url: urlFor(locale, href),
      priority,
      changeFrequency: "weekly" as const,
      // Les memes hreflang que la page, x-default compris : deux listes qui
      // divergeraient feraient douter le robot de l'une et de l'autre.
      alternates: { languages: alternatesFor(locale, href).languages },
    })),
  );
}
