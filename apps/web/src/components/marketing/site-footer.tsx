import { useTranslations } from "next-intl";
import type { ComponentType, SVGProps } from "react";

import { GitHubIcon } from "@/components/brand/social-icons";
import { CookieSettingsButton } from "@/components/legal/cookie-settings-button";
import { Link } from "@/i18n/navigation";
import { SITE_NAME } from "@/lib/site";

/**
 * Chemins internes ; next-intl les traduit en URLs localisées. Les pages de
 * contenu et les pages légales partagent la même rangée : la loi demande que
 * les mentions soient atteignables, pas qu'elles soient reléguées.
 */
const NAV_ITEMS = [
  { key: "concept", href: "/concept" },
  { key: "universes", href: "/univers" },
  { key: "multiverse", href: "/multivers" },
  { key: "lore", href: "/lore" },
  { key: "glossary", href: "/glossaire" },
  { key: "legal", href: "/mentions-legales" },
  { key: "privacy", href: "/confidentialite" },
  { key: "cookies", href: "/cookies" },
] as const;

/**
 * Réseaux. Seul celui qui existe vraiment figure ici : un lien social mort
 * coûte plus qu'il ne rapporte. Les autres logos attendent dans
 * `social-icons.tsx`, il suffit d'ajouter une entrée.
 */
const SOCIAL_ITEMS: {
  name: string;
  href: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}[] = [
  {
    name: "GitHub",
    href: "https://github.com/Jyok1m/odyssai",
    Icon: GitHubIcon,
  },
];

export function SiteFooter() {
  const t = useTranslations("Nav");

  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-wrap overflow-hidden px-6 py-20 sm:py-24 lg:px-8">
        {/* La marge négative compense le gap-y de la rangée : sans elle, un
            retour à la ligne creuserait l'espace sous la navigation. */}
        <nav
          aria-label={t("footerLegal")}
          className="-mb-6 flex flex-wrap justify-center gap-x-12 gap-y-3 text-ui-sm"
        >
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="text-vellum-3 transition-colors hover:text-vellum"
            >
              {t(item.key)}
            </Link>
          ))}
          <CookieSettingsButton />
        </nav>

        {SOCIAL_ITEMS.length > 0 && (
          <div className="mt-16 flex justify-center gap-x-10">
            {SOCIAL_ITEMS.map(({ name, href, Icon }) => (
              <a
                key={name}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-vellum-3 transition-colors hover:text-vellum"
              >
                <span className="sr-only">{name}</span>
                <Icon aria-hidden="true" className="size-6" />
              </a>
            ))}
          </div>
        )}

        {/* Pas de millésime : une année recalculée à chaque build ne dit rien
            de la date de publication et fige un faux signal dans des pages
            prérendues. */}
        <p className="mt-10 text-center text-ui-sm text-vellum-3">
          &copy; {SITE_NAME}. {t("rights")}
        </p>
      </div>
    </footer>
  );
}
