import type { Metadata } from "next";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { CharacterSheet } from "@/components/play/character-sheet";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { ALPHA_OPEN } from "@/lib/flags";
import { pageMetadata } from "@/lib/page-metadata";

const HREF = "/play/character" as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};

  const t = await getTranslations({ locale, namespace: "Sheet" });

  return {
    ...pageMetadata({
      locale,
      href: HREF,
      title: t("title"),
      description: t("lead"),
    }),
    // Page privée, comme la table : ni index, ni sitemap.
    robots: { index: false, follow: false },
  };
}

export default function CharacterPage() {
  const t = useTranslations("Sheet");

  // Le même drapeau que la table : pas de fiche tant qu'on ne peut pas jouer.
  if (!ALPHA_OPEN) notFound();

  return (
    <article className="mx-auto max-w-wrap px-6 pt-32 pb-24 sm:pt-40 lg:px-8">
      <Link
        href="/play"
        className="font-ui text-control font-medium text-vellum-2 transition-colors hover:text-vellum"
      >
        <span aria-hidden="true">&larr;</span> {t("back")}
      </Link>

      <div className="mt-8">
        <CharacterSheet />
      </div>
    </article>
  );
}
