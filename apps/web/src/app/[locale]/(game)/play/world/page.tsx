import type { Metadata } from "next";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { GameGate } from "@/components/play/game-gate";
import { BackToTable, PlayFrame, SheetFallback } from "@/components/play/page-skeletons";
import { WorldBook } from "@/components/play/world-book";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/page-metadata";

const HREF = "/play/world" as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};

  const t = await getTranslations({ locale, namespace: "WorldBook" });

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

export default function WorldPage() {
  const t = useTranslations("WorldBook");

  // La même porte que la table : pas de monde tant qu'on ne peut pas jouer.
  return (
    <GameGate fallback={<SheetFallback label={t("loading")} />}>
      <PlayFrame>
        <BackToTable />

        <div className="mt-8">
          <WorldBook />
        </div>
      </PlayFrame>
    </GameGate>
  );
}
