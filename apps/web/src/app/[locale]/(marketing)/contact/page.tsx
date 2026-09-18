import type { Metadata } from "next";
import { hasLocale, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import { ContactForm } from "@/components/marketing/contact-form";
import { routing } from "@/i18n/routing";
import { pageMetadata } from "@/lib/page-metadata";

const HREF = "/contact" as const;
const NS = "Contact" as const;

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

/**
 * La page de contact.
 *
 * Pas une `ProsePage` : son contenu est un formulaire, pas du texte, et le fil
 * d'Ariane des pages de contenu n'a rien à y faire.
 */
export default function Page() {
  const t = useTranslations(NS);

  return (
    <div className="mx-auto max-w-wrap px-6 pt-32 pb-24 sm:pt-40 lg:px-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="font-voice text-display-compact text-balance text-vellum">
          {t("metaTitle")}
        </h1>
        <p className="mt-6 font-voice text-narration text-pretty text-vellum-2">
          {t("lead")}
        </p>

        <div className="mt-12">
          <ContactForm />
        </div>
      </div>
    </div>
  );
}
