"use client";

import type { AccountErasure } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DangerAction } from "@/components/ui/danger-action";
import { Panel } from "@/components/ui/panel";
import { ProfileError, eraseAccount } from "@/lib/profile";

/*
  Le départ définitif.

  L'API efface les données de jeu et ferme la session, mais pas l'identité :
  elle vit dans le service d'identité, sur lequel l'API n'a volontairement
  aucun droit. L'écran final mène le joueur là où il la supprimera lui-même,
  et lui dit ce qui se passe s'il s'arrête en chemin.
*/
export function EraseAccount() {
  const t = useTranslations("Danger");
  const tAccount = useTranslations("Account");

  const [done, setDone] = useState<AccountErasure | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <Panel title={tAccount("eraseTitle")}>
        <h3 className="font-voice text-subtitle text-vellum">
          {t("erase.doneTitle")}
        </h3>

        {done.world === "kept" ? (
          <p className="mt-3 max-w-measure text-ui-sm text-pretty text-vellum-2">
            {t("restart.kept")}
          </p>
        ) : null}
        {done.character === "remembered" ? (
          <p className="mt-2 max-w-measure text-ui-sm text-pretty text-vellum-2">
            {t("restart.remembered")}
          </p>
        ) : null}

        <p className="mt-4 max-w-measure text-ui-sm text-pretty text-vellum-2">
          {t("erase.doneLead")}
        </p>
        <p className="mt-2 max-w-measure text-ui-sm text-pretty text-brass">
          {t("erase.doneWarning")}
        </p>

        <Button as="a" href={done.accountUrl} variant="danger" className="mt-5">
          {t("erase.finish")} <span aria-hidden="true">&rarr;</span>
        </Button>
      </Panel>
    );
  }

  return (
    /* La bordure dit ce que la carte fait avant qu'on la lise. */
    <Panel title={tAccount("eraseTitle")} className="border-ember/40">
      <p className="max-w-measure text-ui-sm text-pretty text-vellum-2">
        {t("erase.lead")}
      </p>

      {/* Ce qui part, dit avant le bouton et non derriere lui : on ne
          decouvre pas les consequences apres avoir clique. */}
      <ul className="mt-4 space-y-2">
        {["account", "world", "character"].map((what) => (
          <li key={what} className="flex gap-2.5 text-ui-sm text-pretty text-vellum">
            <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-ember" />
            {t(`what.${what}` as never)}
          </li>
        ))}
        <li className="flex gap-2.5 text-ui-sm text-pretty text-vellum-3">
          <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-vellum-3" />
          {t("what.visited")}
        </li>
      </ul>

      <div className="mt-5">
        <DangerAction
      label={t("erase.label")}
      title={t("erase.title")}
      lead={t("erase.lead")}
      confirmLabel={t("erase.confirm")}
      busyLabel={t("erase.busy")}
      error={error}
      onConfirm={async () => {
        setError(null);
        try {
          setDone(await eraseAccount());
        } catch (caught: unknown) {
          const code = caught instanceof ProfileError ? caught.code : "unknown";
          setError(
            tAccount(
              code === "unreachable"
                ? "errorUnreachable"
                : code === "unauthenticated"
                  ? "errorSignedOut"
                  : "errorGeneric",
            ),
          );
        }
      }}
        />
      </div>
    </Panel>
  );
}
