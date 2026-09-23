import type { Metadata } from "next";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { AccountPanel } from "@/components/account/account-panel";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/page-metadata";

const HREF = "/account" as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};

  const t = await getTranslations({ locale, namespace: "Account" });

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

export default function AccountPage() {
  const t = useTranslations("Account");

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

      {/* Moins d'air qu'une page de contenu : ce sont des cartes, et elles
          commencent la ou le titre s'arrete. */}
      <div className="mt-10">
        <AccountPanel />
      </div>
    </article>
  );
}
