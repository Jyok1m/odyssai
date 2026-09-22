"use client";

import type { DepartureOutcome } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { DangerAction } from "@/components/ui/danger-action";
import { OnboardingError, restartOnboarding } from "@/lib/onboarding";

/*
  Recommencer une partie. Le sort du monde et du personnage n'est pas décidé
  ici mais par l'API, selon ce que d'autres joueurs en ont déjà vu : l'écran
  annonce la règle avant, puis rapporte ce qui a réellement été fait.
*/
export function RestartAction({ onDone }: { onDone: () => void }) {
  const t = useTranslations("Danger");
  const tPlay = useTranslations("Play");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<DepartureOutcome | null>(null);

  if (outcome) {
    return (
      <div className="rounded-card border border-line p-5">
        <p className="text-ui-sm text-pretty text-vellum-2">
          {outcome.world === "kept"
            ? t("restart.kept")
            : outcome.character === "remembered"
              ? t("restart.remembered")
              : t("restart.gone")}
        </p>
      </div>
    );
  }

  return (
    <DangerAction
      label={t("restart.label")}
      title={t("restart.title")}
      lead={t("restart.lead")}
      confirmLabel={t("restart.confirm")}
      busyLabel={t("restart.busy")}
      error={error}
      consequences={
        <ul className="space-y-1.5">
          <li>{t("what.world")}</li>
          <li>{t("what.character")}</li>
          <li className="text-vellum-3">{t("what.visited")}</li>
        </ul>
      }
      onConfirm={async () => {
        setError(null);
        try {
          const result = await restartOnboarding();
          setOutcome(result);
          // Le parcours est relu : le serveur a remis le joueur a l'inspiration.
          onDone();
        } catch (caught: unknown) {
          const code =
            caught instanceof OnboardingError ? caught.code : "unknown";
          setError(
            tPlay(
              code === "locked"
                ? "locked"
                : code === "unreachable"
                  ? "errorUnreachable"
                  : code === "unauthenticated"
                    ? "errorSignedOut"
                    : "errorGeneric",
            ),
          );
        }
      }}
    />
  );
}
