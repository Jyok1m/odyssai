import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

import { Constellation } from "./constellation";

export function Hero() {
  const t = useTranslations("Hero");

  return (
    <div className="relative isolate overflow-hidden">
      {/* Plus large mais nettement atténuée en petit écran, comme le kit.
          `min()` n'a pas d'équivalent en classe native. */}
      <Constellation className="pointer-events-none absolute top-6 right-0 -z-10 w-[90%] opacity-35 sm:w-[min(620px,60%)] sm:opacity-100" />

      <div className="mx-auto max-w-wrap px-6 lg:px-8">
        <div className="max-w-3xl py-32 sm:py-40">
          <p className="relative inline-flex items-center rounded-full border border-line px-2.5 py-1 text-tag font-medium text-vellum-2 transition-colors hover:border-vellum-3">
            {t("badge")}{" "}
            <a href="#concept" className="ml-1.5 font-semibold text-accent">
              <span aria-hidden="true" className="absolute inset-0" />
              {t("badgeCta")} <span aria-hidden="true">&rarr;</span>
            </a>
          </p>

          <h1 className="mt-8 font-voice text-display-compact text-balance text-vellum sm:text-display">
            {t("title")}
          </h1>

          <p className="mt-8 max-w-measure text-ui text-pretty text-vellum-2">
            {t("description")}
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Button as="a" href="#login">
              {t("primaryCta")}
            </Button>
            {/* Lien simple et non bouton : sans padding horizontal, il
                reste aligné sur le bouton primaire quand la ligne passe. */}
            <a
              href="#concept"
              className="inline-flex items-center gap-2 text-control font-medium text-vellum transition-colors hover:text-accent"
            >
              {t("secondaryCta")} <span aria-hidden="true">&rarr;</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
