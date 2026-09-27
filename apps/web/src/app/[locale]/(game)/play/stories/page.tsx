import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";

import { GameGate } from "@/components/play/game-gate";
import { PlayFrame, StoriesFallback, StoriesHeader } from "@/components/play/page-skeletons";
import { StoriesPanel } from "@/components/play/stories-panel";
import { routing } from "@/i18n/routing";
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
  // La meme porte que la table : pas d'histoires a gerer tant qu'on ne peut
  // pas jouer.
  return (
    <GameGate fallback={<StoriesFallback />}>
      <PlayFrame>
        <StoriesHeader />

        {/* Le compte et les boutons vivent dans le panneau, avec les cartes :
            ils dependent de ce qu'il a lu. */}
        <div className="mt-8">
          <StoriesPanel />
        </div>
      </PlayFrame>
    </GameGate>
  );
}
