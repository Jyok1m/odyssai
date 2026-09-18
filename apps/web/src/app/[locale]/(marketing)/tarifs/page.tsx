import type { Metadata } from "next";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { Pricing } from "@/components/billing/pricing";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/page-metadata";

const HREF = "/tarifs" as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};

  const t = await getTranslations({ locale, namespace: "Pricing" });

  return pageMetadata({
    locale,
    href: HREF,
    title: t("metaTitle"),
    description: t("metaDescription"),
  });
}

/**
 * La page de tarifs.
 *
 * Ce n'est pas une `ProsePage` : son contenu ne vit pas dans les messages mais
 * dans le catalogue servi par l'API, et il change quand un palier change. Le
 * JSON-LD des pages de contenu ne s'y applique pas non plus, faute de quoi il
 * faudrait y déclarer des offres, que la page ne connaît qu'au chargement.
 */
export default function PricingPage() {
  const t = useTranslations("Pricing");

  return (
    <div className="mx-auto max-w-wrap px-6 pt-32 pb-24 sm:pt-40 lg:px-8">
      {/* Centre, contrairement aux pages de contenu : une grille de paliers se
          lit en colonnes et non en lignes, et un titre pousse a gauche
          au-dessus de colonnes symetriques fait pencher toute la page. */}
      <h1 className="mx-auto max-w-3xl text-center font-voice text-display-compact text-balance text-vellum sm:text-display">
        {t("title")}
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-center font-voice text-narration text-pretty text-vellum-2">
        {t("lead")}
      </p>

      <Pricing />
    </div>
  );
}
