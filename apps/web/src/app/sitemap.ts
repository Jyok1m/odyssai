import type { MetadataRoute } from "next";

import { routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/seo";

/**
 * Chemins publics, sans préfixe de locale. Chaque entrée est déclinée par
 * locale et porte les alternates hreflang des autres.
 *
 * Pas de `lastModified` : une date recalculée à chaque build est un signal
 * faux, et pire qu'une absence de date pour un crawler.
 */
const PATHS = [{ path: "", priority: 1 }] as const;

export default function sitemap(): MetadataRoute.Sitemap {
	return PATHS.flatMap(({ path, priority }) =>
		routing.locales.map((locale) => ({
			url: `${SITE_URL}/${locale}${path}`,
			priority,
			changeFrequency: "weekly" as const,
			alternates: {
				languages: Object.fromEntries(
					routing.locales.map((l) => [l, `${SITE_URL}/${l}${path}`]),
				),
			},
		})),
	);
}
