"use client";

import { useTranslations } from "next-intl";

import { useGameAccess } from "@/components/auth/alpha-provider";
import { useSession } from "@/components/auth/session-provider";

/*
  Ce que le hero dit sous son sous-titre, selon qui regarde. Un inscrit doit
  lire que sa place est prise : son compte existe, le jeu n'est pas ouvert, et
  sans un mot clair l'inscription ressemble à un bug.

  Pendant la lecture de la session, l'invitation reste la bonne réponse.
*/
export function AlphaStanding() {
  const t = useTranslations("Alpha");
  const session = useSession();
  const access = useGameAccess();

  if (access === "open" || session.status !== "authenticated") {
    return (
      <p className="mt-4 max-w-measure text-ui-sm text-pretty text-vellum-3">
        {t("preRegister")}
      </p>
    );
  }

  return (
    <div
      role="status"
      className="mt-6 max-w-measure rounded-card border border-line bg-mist/60 px-5 py-4 text-left"
    >
      <p className="text-ui-sm font-medium text-vellum">{t("reservedTitle")}</p>
      <p className="mt-1 text-ui-sm text-pretty text-vellum-2">
        {t("reservedBody")}
      </p>
    </div>
  );
}
