import type { Metadata } from "next";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import {
  GlossaryList,
  type GlossaryEntry,
} from "@/components/marketing/glossary-list";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/page-metadata";

const HREF = "/glossaire" as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};

  const t = await getTranslations({ locale, namespace: "Glossary" });

  return pageMetadata({
    locale,
    href: HREF,
    title: t("metaTitle"),
    description: t("metaDescription"),
  });
}

export default function GlossaryPage() {
  const t = useTranslations("Glossary");

  return (
    <article className="mx-auto max-w-wrap px-6 pt-32 pb-24 sm:pt-40 lg:px-8">
      <header className="max-w-headline">
        <h1 className="font-voice text-display-compact text-balance text-vellum sm:text-display">
          {t("metaTitle")}
        </h1>
        <p className="mt-8 font-voice text-tagline text-pretty text-vellum-2 italic">
          {t("lead")}
        </p>
      </header>

      <GlossaryList entries={t.raw("entries") as GlossaryEntry[]} />
    </article>
  );
}
