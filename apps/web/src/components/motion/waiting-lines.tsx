"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/*
  Ce qui se passe pendant qu'on attend, dit en une ligne qui change toutes
  les trois secondes environ. Du décor et non un état : rien n'est promis,
  et la ligne s'en va avec l'attente, jamais après.

  Toutes les lignes sont posées l'une sur l'autre dans la même case de
  grille, seule la courante est visible : la case prend la hauteur de la plus
  longue, et un changement de ligne ne pousse rien, même à 320 px où l'une
  passe sur deux rangs. La rotation est une boucle : sous mouvement réduit,
  elle ne part pas et la première ligne reste.

  Le premier rendu montre toujours la première ligne, au serveur comme au
  client : le tirage ne commence qu'après le montage.

  Caché aux lecteurs d'écran : dans une zone `status`, chaque ligne serait
  relue toutes les trois secondes. L'appelant garde un libellé fixe.
*/
export type WaitingContext = "narrator" | "dice" | "character" | "sheet" | "world" | "guide";

const MIN_MS = 2500;
const SPREAD_MS = 1500;

export function WaitingLines({
  context,
  className = "",
}: {
  context: WaitingContext;
  className?: string;
}) {
  const t = useTranslations("Waiting");
  const lines = t.raw(context) as string[];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (lines.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        // Jamais deux fois la même d'affilée : le changement doit se voir.
        setIndex((current) => {
          const next = Math.floor(Math.random() * (lines.length - 1));
          return next >= current ? next + 1 : next;
        });
        schedule();
      }, MIN_MS + Math.random() * SPREAD_MS);
    };
    schedule();

    return () => clearTimeout(timer);
  }, [lines.length]);

  return (
    <span aria-hidden="true" className={`grid ${className}`}>
      {lines.map((line, rank) => (
        <span
          key={rank}
          className={[
            "col-start-1 row-start-1 transition-opacity duration-slow ease-settle",
            rank === index ? "opacity-100" : "opacity-0",
          ].join(" ")}
        >
          {line}
        </span>
      ))}
    </span>
  );
}
