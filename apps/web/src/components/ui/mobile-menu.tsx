"use client";

import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { OdyssaiLogo } from "@/components/brand/odyssai-logo";
import { Link, usePathname } from "@/i18n/navigation";

/*
  Le tiroir des bandeaux sur telephone, partage par le site et le jeu. Chacun
  y met ses actions ; le cadre, la sortie et la fermeture restent ici.
*/

/*
  Tout changement de page ferme le menu, y compris celui qui ne passe par
  aucun de ses liens : le retour du navigateur. Ajuste pendant le rendu,
  comme React le recommande, plutot que par un effet sur le chemin qui
  ferait un rendu de plus.
*/
export function useMobileMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setOpen(false);
  }

  return [open, setOpen] as const;
}

export function MobileMenuButton({
  open,
  onOpen,
}: {
  open: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("Nav");

  return (
    <button
      type="button"
      onClick={onOpen}
      className="-m-2.5 inline-flex items-center justify-center rounded-control p-2.5 text-vellum-2 transition-colors hover:text-vellum"
      aria-expanded={open}
    >
      <span className="sr-only">{t("openMenu")}</span>
      <Bars3Icon aria-hidden="true" className="size-6" />
    </button>
  );
}

/*
  `compact` suit le bandeau du jeu, plus bas sur telephone : la croix tombe
  alors a l'endroit exact du bouton qui a ouvert le tiroir.
*/
export function MobileMenu({
  open,
  onClose,
  compact = false,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  compact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations("Nav");

  return (
    <Dialog open={open} onClose={onClose} className={className}>
      {/* Pas de flou derrière le panneau : un `backdrop-filter` plein
          écran coûte cher sur mobile, et le voile suffit. */}
      <DialogBackdrop
        transition
        className="fixed inset-0 z-50 bg-ink/60 transition-opacity duration-slow ease-emerge data-closed:opacity-0 data-leave:duration-base data-leave:ease-exit"
      />
      <DialogPanel
        transition
        className={[
          "fixed inset-y-0 right-0 z-50 w-full overflow-y-auto overscroll-contain bg-abyss px-safe-6 pb-safe-6 transition duration-slow ease-emerge data-closed:opacity-0 data-leave:duration-base data-leave:ease-exit motion-safe:data-closed:translate-x-full sm:max-w-sm sm:border-l sm:border-line sm:pl-6",
          compact ? "pt-safe-3" : "pt-safe-6",
        ].join(" ")}
      >
        <div className="flex items-center justify-between">
          <Link
            href="/"
            aria-label={t("home")}
            onClick={onClose}
            className="-m-1.5 p-1.5"
          >
            <OdyssaiLogo />
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="-m-2.5 rounded-control p-2.5 text-vellum-2 transition-colors hover:text-vellum"
          >
            <span className="sr-only">{t("closeMenu")}</span>
            <XMarkIcon aria-hidden="true" className="size-6" />
          </button>
        </div>

        <div className="mt-6 flow-root">
          <div className="-my-6 divide-y divide-line">{children}</div>
        </div>
      </DialogPanel>
    </Dialog>
  );
}
