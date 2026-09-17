import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { SignupCta } from "@/components/auth/signup-cta";
import { Link } from "@/i18n/navigation";

import { Constellation } from "./constellation";

/**
 * Colonne centrée plutôt que deux colonnes : le bloc qui suit grandit avec la
 * conversation alors que le hero garde sa hauteur, et rien n'équilibre deux
 * colonnes dont une seule bouge. `children` ferme la pile, sous les boutons.
 */
export function Hero({ children }: { children?: ReactNode }) {
  const t = useTranslations("Hero");
  const tAlpha = useTranslations("Alpha");

  return (
    <div className="relative isolate overflow-hidden">
      {/* Décor de fond et non plus décor de coin : centré derrière le titre,
          assez pâle pour rester une texture. `min()` n'a pas d'équivalent en
          classe native. */}
      <Constellation className="pointer-events-none absolute -top-16 left-1/2 -z-10 w-[min(820px,115%)] -translate-x-1/2 opacity-20 sm:opacity-30" />

      <div className="mx-auto max-w-wrap px-6 lg:px-8">
        <div className="flex flex-col items-center pt-28 pb-24 text-center sm:pt-32 sm:pb-32">
          <p className="relative inline-flex items-center rounded-full border border-line px-2.5 py-1 text-tag font-medium text-vellum-2 transition-colors hover:border-vellum-3">
            {t("badge")}{" "}
            <Link href="/concept" className="ml-1.5 font-semibold text-accent">
              <span aria-hidden="true" className="absolute inset-0" />
              {t("badgeCta")} <span aria-hidden="true">&rarr;</span>
            </Link>
          </p>

          {/* Plus large qu'avant : centré sur 896 px le titre tient en deux
              lignes au lieu de trois, ce qui pose la page au lieu de l'étirer. */}
          <h1 className="mt-6 max-w-4xl font-voice text-display-compact text-balance text-vellum sm:text-display">
            {t("title")}
          </h1>

          <p className="mt-6 max-w-headline text-ui text-pretty text-vellum-2">
            {t("description")}
          </p>

          {/* Dire à quoi mène le bouton avant qu'on l'ait cliqué : ce n'est
              pas une entrée dans le jeu, c'est une place sur la liste. */}
          <p className="mt-4 max-w-measure text-ui-sm text-pretty text-vellum-3">
            {tAlpha("preRegister")}
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
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

          {/* text-left : la conversation ne se lit pas centrée. */}
          {children ? (
            <div className="mt-14 w-full max-w-2xl text-left">{children}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
