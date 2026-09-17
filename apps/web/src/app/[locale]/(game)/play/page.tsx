import type { Metadata } from "next";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { OnboardingWizard } from "@/components/play/onboarding-wizard";
import { routing } from "@/i18n/routing";
import { ALPHA_OPEN } from "@/lib/flags";
import { pageMetadata } from "@/lib/page-metadata";

const HREF = "/play" as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};

  const t = await getTranslations({ locale, namespace: "Play" });

  return {
    ...pageMetadata({
      locale,
      href: HREF,
      title: t("title"),
      description: t("lead"),
    }),
    // Page privee : elle n'a rien a faire dans un index, et elle est absente
    // du sitemap pour la meme raison.
    robots: { index: false, follow: false },
  };
}

export default function PlayPage() {
  const t = useTranslations("Play");

  // Le drapeau garde la route entiere : tant que l'alpha est fermee, entrer
  // en partie n'existe pas, et une page qui dirait « bientot » serait une
  // seconde facon de dire ce que la page d'accueil dit deja.
  if (!ALPHA_OPEN) notFound();

  return (
    <article className="mx-auto max-w-wrap px-6 pt-32 pb-24 sm:pt-40 lg:px-8">
      <header className="max-w-headline">
        <h1 className="font-voice text-display-compact text-balance text-vellum">
          {t("title")}
        </h1>
        <p className="mt-6 max-w-measure text-ui text-pretty text-vellum-2">
          {t("lead")}
        </p>
      </header>

      <div className="mt-14">
        <OnboardingWizard />
      </div>
    </article>
  );
}
