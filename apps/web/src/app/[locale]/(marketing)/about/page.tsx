import type { Metadata } from "next";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { ProsePage, type ProseSection } from "@/components/marketing/prose-page";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/page-metadata";

const HREF = "/about" as const;
const NS = "About" as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};

  const t = await getTranslations({ locale, namespace: NS });

  return pageMetadata({
    locale,
    href: HREF,
    title: t("metaTitle"),
    description: t("metaDescription"),
  });
}

/*
  Qui fait OdyssAI, pourquoi, et où en est le projet.

  Une page de contenu comme les autres, donc elle entre dans le corpus du
  guide : « c'est qui derrière ce site » est une question qu'on pose avant de
  confier son adresse électronique à un jeu en alpha.
*/
export default function Page() {
  const t = useTranslations(NS);

  return (
    <ProsePage
      href={HREF}
      title={t("metaTitle")}
      lead={t("lead")}
      intro={t.raw("intro") as string[]}
      sections={t.raw("sections") as ProseSection[]}
    />
  );
}
