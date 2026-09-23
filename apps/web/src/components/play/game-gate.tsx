"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { useGameAccess } from "@/components/auth/alpha-provider";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Link } from "@/i18n/navigation";

/*
  Les pages de jeu derrière la phase de l'alpha. Fermée, la page le dit au
  lieu de répondre 404 : la phase est publique, le bandeau l'annonce déjà, il
  n'y a plus rien à taire. Rien tant qu'on ne sait pas, plutôt qu'un état
  qu'on démentirait.
*/
export function GameGate({ children }: { children: ReactNode }) {
  const t = useTranslations("Alpha");
  const access = useGameAccess();

  if (access === "loading") return null;
  if (access === "open") return <>{children}</>;

  return (
    <article className="mx-auto max-w-wrap px-6 pt-32 pb-24 sm:pt-40 lg:px-8">
      <Panel title={t("closedTitle")} className="max-w-measure">
        <p className="text-ui-sm text-pretty text-vellum-2">{t("closedBody")}</p>
        <Button as={Link} href="/" variant="secondary" className="mt-5">
          {t("closedHome")}
        </Button>
      </Panel>
    </article>
  );
}
