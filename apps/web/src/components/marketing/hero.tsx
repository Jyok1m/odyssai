import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { SignupCta } from "@/components/auth/signup-cta";
import { Link } from "@/i18n/navigation";

import { Constellation } from "./constellation";

/**
 * `aside` tient la colonne de droite. La page décide de ce qu'elle y met : le
 * hero ne connaît pas le guide, il lui donne une place à hauteur du titre.
 */
export function Hero({ aside }: { aside?: ReactNode }) {
  const t = useTranslations("Hero");
  const tAlpha = useTranslations("Alpha");

  return (
    <div className="relative isolate overflow-hidden">
      {/* Plus large mais nettement atténuée en petit écran, comme le kit.
          `min()` n'a pas d'équivalent en classe native. Estompée à partir de
          xl, où le panneau se pose devant elle. */}
      <Constellation className="pointer-events-none absolute top-6 right-0 -z-10 w-[90%] opacity-35 sm:w-[min(620px,60%)] sm:opacity-100 xl:opacity-40" />

      <div className="mx-auto max-w-wrap px-6 lg:px-8">
        {/* Deux colonnes seulement à partir de xl : en dessous, le conteneur
            n'a pas la largeur d'un titre de 56 px à côté d'un panneau, et le
            guide repasse sous le hero. */}
        <div className="grid gap-12 pt-28 pb-24 sm:pt-32 sm:pb-32 xl:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] xl:items-start xl:gap-16">
          <div className="max-w-3xl">
            <p className="relative inline-flex items-center rounded-full border border-line px-2.5 py-1 text-tag font-medium text-vellum-2 transition-colors hover:border-vellum-3">
              {t("badge")}{" "}
              <Link href="/concept" className="ml-1.5 font-semibold text-accent">
                <span aria-hidden="true" className="absolute inset-0" />
                {t("badgeCta")} <span aria-hidden="true">&rarr;</span>
              </Link>
            </p>

            <h1 className="mt-6 font-voice text-display-compact text-balance text-vellum sm:text-display">
              {t("title")}
            </h1>

            <p className="mt-6 max-w-measure text-ui text-pretty text-vellum-2">
              {t("description")}
            </p>

            {/* Dire à quoi mène le bouton avant qu'on l'ait cliqué : ce n'est
                pas une entrée dans le jeu, c'est une place sur la liste. */}
            <p className="mt-6 max-w-measure text-ui-sm text-vellum-3">
              {tAlpha("preRegister")}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <SignupCta>{t("primaryCta")}</SignupCta>
              {/* Lien simple et non bouton : sans padding horizontal, il
                  reste aligné sur le bouton primaire quand la ligne passe. */}
              <Link
                href="/concept"
                className="inline-flex items-center gap-2 text-control font-medium text-vellum transition-colors hover:text-accent"
              >
                {t("secondaryCta")} <span aria-hidden="true">&rarr;</span>
              </Link>
            </div>
          </div>

          {aside}
        </div>
      </div>
    </div>
  );
}
