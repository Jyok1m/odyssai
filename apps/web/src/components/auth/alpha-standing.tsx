"use client";

import { useTranslations } from "next-intl";

import { useGameAccess } from "@/components/auth/alpha-provider";
import { useSession } from "@/components/auth/session-provider";

/*
  Ce que le hero dit sous son sous-titre, selon qui regarde et si le jeu est
  ouvert. À qui n'a pas de compte, l'invitation et ce que vaut l'alpha ; à
  qui en a un, les règles du jeu tel qu'il est : des bugs possibles, un
  bouton pour les signaler, pas d'abonnement, une progression qui peut être
  remise à zéro. Porte fermée, la raison, et que les comptes restent.

  Pendant la lecture de la session, l'invitation reste la bonne réponse.
*/
export function AlphaStanding() {
  const t = useTranslations("Alpha");
  const session = useSession();
  const access = useGameAccess();

  if (session.status !== "authenticated") {
    return (
      <p className="mt-4 max-w-measure text-ui-sm text-pretty text-vellum-3">
        {access === "closed" ? t("closedInvite") : t("openInvite")}
      </p>
    );
  }

  const closed = access === "closed";

  return (
    <div
      role="status"
      className="mt-6 max-w-measure rounded-card border border-line bg-mist/60 px-5 py-4 text-left"
    >
      <p className="text-ui-sm font-medium text-vellum">
        {closed ? t("reservedTitle") : t("playingTitle")}
      </p>
      <p className="mt-1 text-ui-sm text-pretty text-vellum-2">
        {closed ? t("reservedBody") : t("playingBody")}
      </p>
    </div>
  );
}
