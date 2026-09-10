"use client";

import { Dialog, DialogPanel } from "@headlessui/react";
import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { OdyssaiLogo } from "@/components/brand/odyssai-logo";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

import { LocaleSwitcher } from "./locale-switcher";

/** Ancres de section : les sections correspondantes restent à construire. */
const NAV_ITEMS = [
  { key: "concept", href: "#concept" },
  { key: "universes", href: "#universes" },
  { key: "multiverse", href: "#multiverse" },
  { key: "lore", href: "#lore" },
] as const;

export function SiteHeader() {
  const t = useTranslations("Nav");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
          >
            <span className="sr-only">{t("openMenu")}</span>
            <Bars3Icon aria-hidden="true" className="size-6" />
          </button>
        </div>

        <div className="hidden lg:flex lg:gap-x-10">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.key}
              href={item.href}
              className="text-ui-sm font-medium text-vellum-2 transition-colors hover:text-vellum"
            >
              {t(item.key)}
            </a>
          ))}
        </div>

        <div className="hidden lg:flex lg:flex-1 lg:items-center lg:justify-end lg:gap-x-4">
          <LocaleSwitcher />
          <Button as="a" href="#login" variant="secondary" size="sm">
            {t("login")}
          </Button>
        </div>
      </nav>

      <Dialog
        open={mobileMenuOpen}
        onClose={setMobileMenuOpen}
        className="lg:hidden"
      >
        <div className="fixed inset-0 z-50 bg-ink/60" />
        <DialogPanel className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-abyss p-6 sm:max-w-sm sm:border-l sm:border-line">
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
              <div className="space-y-1 py-6">
                {NAV_ITEMS.map((item) => (
                  <a
                    key={item.key}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="-mx-3 block rounded-control px-3 py-2 text-narration font-medium text-vellum transition-colors hover:bg-mist"
                  >
                    {t(item.key)}
                  </a>
                ))}
              </div>
              <div className="py-6">
                <Button
                  as="a"
                  href="#login"
                  variant="secondary"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full"
                >
                  {t("login")}
                </Button>
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
