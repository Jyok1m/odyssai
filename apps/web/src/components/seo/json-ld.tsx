import { getTranslations } from "next-intl/server";

import { routing, type Locale, type Pathname } from "@/i18n/routing";
import { SITE_URL, urlFor } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";

// `<` échappé : un `</script>` dans une chaîne fermerait la balise.
function JsonLdScript({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}

/*
  Limitées à ce qui est vérifiable : ni note agrégée, ni offre, ni date de
  sortie, qui seraient inventées et vaudraient une pénalité pour balisage
  trompeur.
*/
export async function JsonLd({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "Metadata" });
  const seo = await getTranslations({ locale, namespace: "Seo" });

  return (
    <JsonLdScript
      data={{
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
            url: urlFor(locale),
            description: t("description"),
            inLanguage: locale,
            genre: seo("genre"),
            applicationCategory: "GameApplication",
            gamePlatform: "Web browser",
            publisher: { "@id": `${SITE_URL}/#organization` },
          },
        ],
      }}
    />
  );
}

// Le site est plat : l'accueil, puis la page. `urlFor` donne le chemin localisé.
export async function BreadcrumbJsonLd({
  locale,
  href,
  name,
}: {
  locale: Locale;
  href: Pathname;
  name: string;
}) {
  const seo = await getTranslations({ locale, namespace: "Seo" });

  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: seo("home"),
            item: urlFor(locale),
          },
          { "@type": "ListItem", position: 2, name, item: urlFor(locale, href) },
        ],
      }}
    />
  );
}
