import type { Metadata } from "next";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { GameGate } from "@/components/play/game-gate";
import { CharacterSheet } from "@/components/play/character-sheet";
import { BackToTable, PlayFrame, SheetFallback } from "@/components/play/page-skeletons";
import { routing } from "@/i18n/routing";
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

  // La même porte que la table : pas de fiche tant qu'on ne peut pas jouer.
  return (
    <GameGate fallback={<SheetFallback label={t("loading")} />}>
      <PlayFrame>
        <BackToTable />

        <div className="mt-8">
          <CharacterSheet />
        </div>
      </PlayFrame>
    </GameGate>
  );
}
