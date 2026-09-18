import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    // `/admin` est deja en noindex par ses metadonnees, et garde par l'API.
    // Le dire ici aussi evite qu'un robot aille frapper des routes qui ne lui
    // repondront que des 401 : deux enonces valent mieux qu'un sur une page
    // qui ne doit jamais remonter dans un resultat.
    rules: [{ userAgent: "*", allow: "/", disallow: "/admin" }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
