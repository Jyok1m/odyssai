import { useTranslations } from "next-intl";

import { AlphaCta } from "@/components/alpha/alpha-cta";
import { Link } from "@/i18n/navigation";

import { Constellation } from "./constellation";

/**
 * Destination une fois l'alpha ouverte. La route n'existe pas encore : tant
 * que NEXT_PUBLIC_ALPHA_OPEN est faux, le clic n'ouvre qu'un toast.
 */
const SIGNUP_HREF = "/signup";

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
            <Link href="/concept" className="ml-1.5 font-semibold text-accent">
              <span aria-hidden="true" className="absolute inset-0" />
              {t("badgeCta")} <span aria-hidden="true">&rarr;</span>
            </Link>
          </p>

          <h1 className="mt-8 font-voice text-display-compact text-balance text-vellum sm:text-display">
            {t("title")}
          </h1>

          <p className="mt-8 max-w-measure text-ui text-pretty text-vellum-2">
            {t("description")}
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <AlphaCta href={SIGNUP_HREF}>{t("primaryCta")}</AlphaCta>
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
      </div>
    </div>
  );
}
