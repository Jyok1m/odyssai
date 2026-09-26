"use client";

import { useTranslations } from "next-intl";

import { AdminLink } from "@/components/auth/admin-link";
import { AuthMenu } from "@/components/auth/auth-menu";
import { OdyssaiLogo, OdyssaiMark } from "@/components/brand/odyssai-logo";
import { BugReportButton } from "@/components/play/bug-report";
import { LocaleSwitcher } from "@/components/marketing/locale-switcher";
import {
  MobileMenu,
  MobileMenuButton,
  useMobileMenu,
} from "@/components/ui/mobile-menu";
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
  const [menuOpen, setMenuOpen] = useMobileMenu();

  return (
    /*
      Dans le flux sous `sm`, pose sur la page au dela. Sur telephone, une
      seule ligne de 56 px : le symbole, les onglets, le reste dans le tiroir.
      A 320 px, 32 + 24 + ~145 d'onglets + 24 + 24 du bouton tiennent dans
      les 272 px entre les marges ; le logo complet, 121 px, ne tiendrait pas.
    */
    <header className="relative z-50 sm:absolute sm:inset-x-0 sm:top-0">
      <nav
        aria-label={t("label")}
        className="mx-auto flex max-w-wrap items-center gap-x-6 gap-y-4 px-6 py-3 sm:flex-wrap sm:gap-x-8 sm:py-6 lg:px-8"
      >
        <Link
          href="/"
          aria-label={tNav("home")}
          className="-m-1.5 shrink-0 p-1.5"
        >
          <OdyssaiMark className="block size-8 sm:hidden" />
          <OdyssaiLogo className="hidden h-8 w-auto sm:block" />
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
                  "touch-target border-b-2 pb-1 text-ui-sm font-medium whitespace-nowrap transition-colors",
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

        <div className="ml-auto flex sm:hidden">
          <MobileMenuButton
            open={menuOpen}
            onOpen={() => setMenuOpen(true)}
          />
        </div>

        <div className="hidden items-center gap-x-3 sm:ml-auto sm:flex">
          <BugReportButton />
          <AdminLink />
          <LocaleSwitcher />
          <AuthMenu />
        </div>
      </nav>

      <MobileMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        compact
        className="sm:hidden"
      >
        <div className="space-y-3 py-6">
          <AuthMenu size="md" stacked />
          <AdminLink size="md" stacked />
          <BugReportButton size="md" stacked />
        </div>
        <div className="py-6">
          <LocaleSwitcher
            className="-mx-1"
            onNavigate={() => setMenuOpen(false)}
          />
        </div>
      </MobileMenu>
    </header>
  );
}
