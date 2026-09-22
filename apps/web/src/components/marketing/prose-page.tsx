import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { PageNav, type NavSection } from "@/components/marketing/page-nav";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import type { Locale, Pathname } from "@/i18n/routing";

export type ProseSection = {
  title: string;
  body: string[];
};

/*
  Gabarit des pages de contenu. Chaque page lit ses propres messages et passe
  le texte résolu, ce qui évite un namespace dynamique et garde le typage des
  clés. `href` est le chemin interne, celui du dossier sous app/[locale] : il
  ne sert qu'au fil d'Ariane, que toutes ces pages doivent porter.

  Le kit alterne un chapeau étroit et du contenu qui occupe la largeur : ici
  la prose garde sa longueur de ligne et c'est le sommaire qui remplit la
  colonne de droite, comme l'écran de jeu du kit en `1fr 296px`.
*/
export function ProsePage({
  href,
  title,
  lead,
  intro,
  sections,
  footer,
}: {
  href: Pathname;
  title: string;
  lead: string;
  intro: string[];
  sections: ProseSection[];
  footer?: ReactNode;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations("Nav");
  const nav = toNavSections(sections);

  return (
    <article className="mx-auto max-w-wrap px-6 pt-32 pb-24 sm:pt-40 lg:px-8">
      <BreadcrumbJsonLd locale={locale} href={href} name={title} />

      <header className="max-w-headline">
        <h1 className="font-voice text-display-compact text-balance text-vellum sm:text-display">
          {title}
        </h1>
        <p className="mt-8 font-voice text-tagline text-pretty text-vellum-2 italic">
          {lead}
        </p>
      </header>

      <div className="mt-14 grid gap-x-12 lg:grid-cols-[minmax(0,1fr)_296px]">
        <div className="max-w-headline">
          <div className="space-y-6 font-voice text-narration text-pretty text-vellum">
            {intro.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>

          {sections.map((section, index) => (
            <section key={section.title} className="mt-16">
              <h2
                id={nav[index]!.id}
                className="scroll-mt-24 font-voice text-subtitle text-vellum"
              >
                {section.title}
              </h2>
              <div className="mt-4 space-y-6 font-voice text-narration text-pretty text-vellum">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}

          {footer ? <div className="mt-16">{footer}</div> : null}
        </div>

        {nav.length > 1 ? (
          <PageNav label={t("onThisPage")} sections={nav} />
        ) : null}
      </div>
    </article>
  );
}

/*
  Ancres stables tirées des titres. Le rang sert de repli : deux sections
  homonymes, ou un titre sans aucun caractère latin, produiraient sinon la
  même ancre et le sommaire renverrait toujours à la première.
*/
function toNavSections(sections: ProseSection[]): NavSection[] {
  const seen = new Set<string>();

  return sections.map((section, index) => {
    const slug = section.title
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const id = !slug || seen.has(slug) ? `section-${index + 1}` : slug;
    seen.add(id);
    return { id, title: section.title };
  });
}
