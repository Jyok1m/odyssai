"use client";

import type { WorldView } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import { WorldError, fetchWorld } from "@/lib/world";

/*
  Le monde courant, relu par les trois écrans de jeu : la table, la fiche et
  le livre du monde. Un seul appel, une seule façon d'échouer.

  `not_ready` n'est pas une panne : le monde n'est pas encore généré, et
  l'écran doit le dire autrement qu'une erreur.
*/
export type WorldState =
  | { status: "loading" }
  | { status: "ready"; world: WorldView }
  | { status: "not_ready" }
  | { status: "error" };

export function useWorld(): WorldState {
  const [state, setState] = useState<WorldState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    fetchWorld(controller.signal)
      .then((world) => setState({ status: "ready", world }))
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status:
            caught instanceof WorldError && caught.code === "not_ready"
              ? "not_ready"
              : "error",
        });
      });

    return () => controller.abort();
  }, []);

  return state;
}

/*
  La teinte du monde. Le kit dérive l'accent de `--world-hue` sous
  `[data-world]`, avec sa transition : poser la teinte suffit, et écrire
  `--accent` à la main contournerait la règle au lieu de la suivre.
*/
export function WorldSkin({
  world,
  className,
  children,
}: {
  world: WorldView;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-world={world.name}
      style={{ "--world-hue": world.accentHue } as CSSProperties}
      className={className}
    >
      {children}
    </div>
  );
}

/*
  Ce qu'on montre quand le monde n'est pas là : la raison, et le chemin du
  retour. Une page de jeu vide sans issue se lit comme une panne.
*/
export function Absent({ message }: { message: string }) {
  const t = useTranslations("Sheet");

  return (
    <div className="flex flex-col items-start gap-4">
      <p className="text-ui-sm text-pretty text-vellum-2">{message}</p>
      <Link
        href="/play"
        className="font-ui text-control font-medium text-accent transition-colors hover:text-vellum"
      >
        {t("back")} <span aria-hidden="true">&rarr;</span>
      </Link>
    </div>
  );
}
