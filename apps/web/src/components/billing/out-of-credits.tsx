"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

/*
  Le refus quand la réserve est vide.

  Dit ce qui manque et où le régler, sans dramatiser : rien n'est perdu, le
  mois suivant rend la dotation. Jamais de facture surprise, donc jamais de
  tour joué à crédit.
*/
export function OutOfCredits() {
  const t = useTranslations("Billing");

  return (
    <span className="text-brass">
      {t("outOfCredits")}{" "}
      <Link
        href="/compte"
        className="underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
      >
        {t("seePlans")}
      </Link>
    </span>
  );
}
