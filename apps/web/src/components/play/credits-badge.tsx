"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { fetchBillingSummary } from "@/lib/billing";

/*
  La réserve, sur la table de jeu.

  Un tour coûte un crédit, et le joueur doit pouvoir le voir sans quitter la
  partie. Relue après chaque tour plutôt que décrémentée sur place : un
  administrateur ne consomme rien, et un compteur qui descendrait chez lui
  mentirait.

  N'échoue jamais. Une facturation indisponible garde la dernière valeur
  connue, ou ne montre rien du tout si elle n'a jamais répondu : on joue sans
  compteur, on ne s'arrête pas de jouer.
*/
export function CreditsBadge({ refreshKey }: { refreshKey: number }) {
  const t = useTranslations("Game");
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchBillingSummary(controller.signal)
      .then((summary) => setCredits(summary.credits))
      .catch(() => {});

    return () => controller.abort();
  }, [refreshKey]);

  if (credits === null) return null;

  return (
    <span className="text-caption text-vellum-3">{t("credits", { credits })}</span>
  );
}
