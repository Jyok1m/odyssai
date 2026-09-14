import type { Metadata } from "next";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { ProsePage, type ProseSection } from "@/components/marketing/prose-page";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/page-metadata";

const HREF = "/mentions-legales" as const;
const NS = "LegalNotice" as const;

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

export default function Page() {
  const t = useTranslations(NS);

  return (
    <ProsePage
      title={t("metaTitle")}
      lead={t("lead")}
      intro={t.raw("intro") as string[]}
      sections={t.raw("sections") as ProseSection[]}
    />
  );
}
