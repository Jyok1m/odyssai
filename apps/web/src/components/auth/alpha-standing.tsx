"use client";

import { useTranslations } from "next-intl";

import { useSession } from "@/components/auth/session-provider";
import { ALPHA_OPEN } from "@/lib/flags";

/*
  Ce que le hero dit sous son sous-titre, selon qui regarde.

  Un visiteur lit l'invitation à réserver sa place. Un joueur déjà inscrit,
  lui, a besoin d'autre chose : son compte existe, le jeu n'est pas ouvert, et
  sans un mot clair l'inscription ressemble à un bug. Il lit donc que sa place
  est prise et que ses crédits l'attendent.

  Avant, c'était un toast au clic sur le bouton principal : trois secondes
  pour une nouvelle qui vaut d'être relue, et rien tant qu'on ne cliquait pas.
  Même raisonnement que le bandeau des places prises.

  Pendant la lecture de la session, l'invitation reste la bonne réponse :
  c'est ce que verra la grande majorité, et elle ne ment à personne.
*/
export function AlphaStanding() {
  const t = useTranslations("Alpha");
  const session = useSession();

  if (ALPHA_OPEN || session.status !== "authenticated") {
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
