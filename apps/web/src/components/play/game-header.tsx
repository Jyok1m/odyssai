"use client";

import { useTranslations } from "next-intl";

import { AdminLink } from "@/components/auth/admin-link";
import { AuthMenu } from "@/components/auth/auth-menu";
import { OdyssaiLogo } from "@/components/brand/odyssai-logo";
import { LocaleSwitcher } from "@/components/marketing/locale-switcher";
import { Link, usePathname } from "@/i18n/navigation";

/*
  Le bandeau des écrans de jeu.

  Celui du site vitrine porte Concept, Univers, Multivers, Lore et Tarifs :
  cinq pages de vente au-dessus d'une table de jeu, à quoi personne ne revient
  en pleine partie. Ici il n'y a que le retour au site, les onglets du jeu, et
  de quoi joindre son compte.
*/
const TABS = [
  { key: "play", href: "/play" },
  { key: "stories", href: "/play/stories" },
] as const;

export function GameHeader() {
  const t = useTranslations("Stories.tabs");
  const tNav = useTranslations("Nav");
  const pathname = usePathname();

  return (
    <header className="absolute inset-x-0 top-0 z-50">
      <nav
        aria-label={t("label")}
        className="mx-auto flex max-w-wrap flex-wrap items-center gap-x-8 gap-y-4 px-6 py-6 lg:px-8"
      >
        <Link href="/" aria-label={tNav("home")} className="-m-1.5 p-1.5">
          <OdyssaiLogo />
        </Link>

        <div className="flex gap-x-6">
          {TABS.map((tab) => {
            /*
              La fiche et le livre du monde sont des annexes de la table :
              l'onglet « Jouer » reste actif chez elles, sinon on lit deux
              onglets éteints et on se croit sorti du jeu.
            */
            const active =
              tab.href === "/play"
                ? pathname !== "/play/stories"
                : pathname === tab.href;

            return (
              <Link
                key={tab.key}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "border-b-2 pb-1 text-ui-sm font-medium transition-colors",
                  active
                    ? "border-accent text-vellum"
                    : "border-transparent text-vellum-2 hover:text-vellum",
                ].join(" ")}
              >
                {t(tab.key)}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-x-3 sm:ml-auto">
          <AdminLink />
          <LocaleSwitcher />
          <AuthMenu />
        </div>
      </nav>
    </header>
  );
}
