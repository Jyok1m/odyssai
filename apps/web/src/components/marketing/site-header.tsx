"use client";

import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { AdminLink } from "@/components/auth/admin-link";
import { AuthMenu } from "@/components/auth/auth-menu";
import { OdyssaiLogo } from "@/components/brand/odyssai-logo";
import { Link, usePathname } from "@/i18n/navigation";

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
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  /*
    Tout changement de page ferme le menu, y compris celui qui ne passe par
    aucun de ses liens : le retour du navigateur. Ajuste pendant le rendu,
    comme React le recommande, plutot que par un effet sur le chemin qui
    ferait un rendu de plus.
  */
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMobileMenuOpen(false);
  }

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
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="-m-2.5 inline-flex items-center justify-center rounded-control p-2.5 text-vellum-2 transition-colors hover:text-vellum"
            aria-expanded={mobileMenuOpen}
          >
            <span className="sr-only">{t("openMenu")}</span>
            <Bars3Icon aria-hidden="true" className="size-6" />
          </button>
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

      <Dialog
        open={mobileMenuOpen}
        onClose={setMobileMenuOpen}
        className="lg:hidden"
      >
        {/* Pas de flou derrière le panneau : un `backdrop-filter` plein
            écran coûte cher sur mobile, et le voile suffit. */}
        <DialogBackdrop
          transition
          className="fixed inset-0 z-50 bg-ink/60 transition-opacity duration-slow ease-emerge data-closed:opacity-0 data-leave:duration-base data-leave:ease-exit"
        />
        <DialogPanel
          transition
          className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto overscroll-contain bg-abyss p-safe-6 transition duration-slow ease-emerge data-closed:opacity-0 data-leave:duration-base data-leave:ease-exit motion-safe:data-closed:translate-x-full sm:max-w-sm sm:border-l sm:border-line sm:pl-6"
        >
          <div className="flex items-center justify-between">
            <Link
              href="/"
              aria-label={t("home")}
              onClick={() => setMobileMenuOpen(false)}
              className="-m-1.5 p-1.5"
            >
              <OdyssaiLogo />
            </Link>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="-m-2.5 rounded-control p-2.5 text-vellum-2 transition-colors hover:text-vellum"
            >
              <span className="sr-only">{t("closeMenu")}</span>
              <XMarkIcon aria-hidden="true" className="size-6" />
            </button>
          </div>

          <div className="mt-6 flow-root">
            <div className="-my-6 divide-y divide-line">
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
            </div>
          </div>
        </DialogPanel>
      </Dialog>
    </header>
  );
}
