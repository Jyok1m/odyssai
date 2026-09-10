import type { Metadata } from "next";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import {
  ProsePage,
  type ProseSection,
} from "@/components/marketing/prose-page";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/page-metadata";

const HREF = "/lore" as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};

  const t = await getTranslations({ locale, namespace: "Lore" });

  return pageMetadata({
    locale,
    href: HREF,
    title: t("metaTitle"),
    description: t("metaDescription"),
  });
}

export default function LorePage() {
  const t = useTranslations("Lore");

  return (
    <ProsePage
      title={t("metaTitle")}
      lead={t("lead")}
      intro={t.raw("intro") as string[]}
      sections={t.raw("sections") as ProseSection[]}
      footer={
        <Link
          href="/glossaire"
          className="inline-flex items-center gap-2 font-ui text-control font-medium text-accent transition-colors hover:text-vellum"
        >
          {t("glossaryCta")} <span aria-hidden="true">&rarr;</span>
        </Link>
      }
    />
  );
}
