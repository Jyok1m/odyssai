import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    /*
      `/admin` est deja en noindex par ses metadonnees et garde par l'API. Le
      dire ici evite qu'un robot frappe des routes qui ne rendront que des 401.
    */
    rules: [{ userAgent: "*", allow: "/", disallow: "/admin" }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
