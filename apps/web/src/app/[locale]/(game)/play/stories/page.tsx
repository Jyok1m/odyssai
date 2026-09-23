import type { Metadata } from "next";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { StoriesPanel } from "@/components/play/stories-panel";
import { routing } from "@/i18n/routing";
import { ALPHA_OPEN } from "@/lib/flags";
import { pageMetadata } from "@/lib/page-metadata";

const HREF = "/play/stories" as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};

  const t = await getTranslations({ locale, namespace: "Stories" });

  return {
    ...pageMetadata({
      locale,
      href: HREF,
      title: t("title"),
      description: t("lead"),
    }),
    // Page privee, comme la table : ni index, ni sitemap.
    robots: { index: false, follow: false },
  };
}

export default function StoriesPage() {
  const t = useTranslations("Stories");

  // Le meme drapeau que la table : pas d'histoires a gerer tant qu'on ne
  // peut pas jouer.
  if (!ALPHA_OPEN) notFound();

  return (
    <article className="mx-auto max-w-wrap px-6 pt-32 pb-24 sm:pt-40 lg:px-8">
      <header className="max-w-headline">
        <h1 className="font-voice text-display-compact text-balance text-vellum">
          {t("title")}
        </h1>
        <p className="mt-4 max-w-measure text-ui text-pretty text-vellum-2">
          {t("lead")}
        </p>
      </header>

      {/* Le compte et les boutons vivent dans le panneau, avec les cartes :
          ils dependent de ce qu'il a lu. */}
      <div className="mt-8">
        <StoriesPanel />
      </div>
    </article>
  );
}
