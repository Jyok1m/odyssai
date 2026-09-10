import { getTranslations } from "next-intl/server";

import { routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";

type Locale = (typeof routing.locales)[number];

/**
 * Données structurées schema.org. Volontairement limitées à ce qui est
 * vérifiable : ni note agrégée, ni offre, ni date de sortie, qui seraient
 * inventées et exposeraient à une pénalité pour balisage trompeur.
 */
export async function JsonLd({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "Metadata" });
  const seo = await getTranslations({ locale, namespace: "Seo" });

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        description: t("description"),
        inLanguage: [...routing.locales],
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: `${SITE_URL}/odyssai-logo-dark.svg`,
      },
      {
        "@type": "VideoGame",
        "@id": `${SITE_URL}/#game`,
        name: SITE_NAME,
        url: `${SITE_URL}/${locale}`,
        description: t("description"),
        inLanguage: locale,
        genre: seo("genre"),
        applicationCategory: "GameApplication",
        gamePlatform: "Web browser",
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // `<` échappé : un `</script>` dans une chaîne fermerait la balise.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(graph).replace(/</g, "\\u003c"),
      }}
    />
  );
}
