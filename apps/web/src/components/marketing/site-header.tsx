"use client";

import { useTranslations } from "next-intl";

import { AdminLink } from "@/components/auth/admin-link";
import { AuthMenu } from "@/components/auth/auth-menu";
import { OdyssaiLogo } from "@/components/brand/odyssai-logo";
import {
  MobileMenu,
  MobileMenuButton,
  useMobileMenu,
} from "@/components/ui/mobile-menu";
import { Link } from "@/i18n/navigation";

import { LocaleSwitcher } from "./locale-switcher";

// Chemins internes ; next-intl les traduit en URLs localisées.
const NAV_ITEMS = [
  { key: "concept", href: "/concept" },
  { key: "universes", href: "/universes" },
  { key: "multiverse", href: "/multiverse" },
  { key: "lore", href: "/lore" },
  { key: "pricing", href: "/pricing" },
] as const;

/*
  Un trait d'accent se déroule sous le lien survolé. Un `scale`, pas une
  largeur : il ne réagence rien. Le pseudo-élément suit le texte, le lien
  garde son liseré de focus.
*/
const NAV_LINK =
  "touch-target text-ui-sm font-medium text-vellum-2 transition-colors hover:text-vellum after:absolute after:inset-x-0 after:-bottom-1 after:h-px after:origin-left after:scale-x-0 after:bg-accent after:transition-transform after:duration-base after:ease-emerge hover:after:scale-x-100 motion-reduce:after:transition-none";

export function SiteHeader() {
  const t = useTranslations("Nav");
  const [mobileMenuOpen, setMobileMenuOpen] = useMobileMenu();

  return (
    <header className="absolute inset-x-0 top-0 z-50">
      <nav
        aria-label="Global"
        className="mx-auto flex max-w-wrap items-center justify-between px-6 py-6 lg:px-8"
      >
        <div className="flex lg:flex-1">
          <Link href="/" aria-label={t("home")} className="-m-1.5 p-1.5">
            <OdyssaiLogo />
          </Link>
        </div>

        <div className="flex lg:hidden">
          <MobileMenuButton
            open={mobileMenuOpen}
            onOpen={() => setMobileMenuOpen(true)}
          />
        </div>

        {/* Un cran plus serre depuis que Tarifs s'y ajoute : a dix, la
            navigation touchait le groupe d'actions sur un portable. */}
        <div className="hidden lg:flex lg:gap-x-7">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={NAV_LINK}
            >
              {t(item.key)}
            </Link>
          ))}
        </div>

        <div className="hidden lg:flex lg:flex-1 lg:items-center lg:justify-end lg:gap-x-3">
          <AdminLink />
          {/* Les actions ne sont pas des pages : sans cette separation, le
              dernier lien de navigation et le premier bouton se lisaient
              comme une suite d'onglets. */}
          <span aria-hidden="true" className="h-5 w-px bg-line" />
          <LocaleSwitcher />
          <AuthMenu />
        </div>
      </nav>

      <MobileMenu
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        className="lg:hidden"
      >
        <div className="stagger space-y-1 py-6">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              onClick={() => setMobileMenuOpen(false)}
              className="-mx-3 block min-h-11 rounded-control px-3 py-2 text-narration font-medium text-vellum transition-colors hover:bg-mist"
            >
              {t(item.key)}
            </Link>
          ))}
        </div>
        <div className="space-y-3 py-6">
          <AuthMenu size="md" stacked />
          <AdminLink size="md" stacked />
        </div>
        <div className="py-6">
          <LocaleSwitcher
            className="-mx-1"
            onNavigate={() => setMobileMenuOpen(false)}
          />
        </div>
      </MobileMenu>
    </header>
  );
}
