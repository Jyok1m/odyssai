import type { HTMLAttributes } from "react";

/*
  Une jauge : la vie, l'avancement d'un attribut, la réserve de crédits.

  Le remplissage garde toute la largeur et se découpe par `clip-path` : une
  largeur animée recalcule la mise en page à chaque image, une découpe passe
  par le compositeur. Il se remplit à l'arrivée, puis suit la valeur.
*/
export function Meter({
  value,
  tone = "bg-accent",
  rounded = false,
  className,
  ...rest
}: {
  // De 0 à 100.
  value: number;
  // Une classe de fond : la couleur reste décidée par l'appelant.
  tone?: string;
  // Des extrémités rondes, comme la réserve de crédits.
  rounded?: boolean;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "className">) {
  const hidden = 100 - Math.min(100, Math.max(0, value));

  return (
    <div
      className={[
        "h-1.5 overflow-hidden bg-mist",
        rounded ? "rounded-full" : "rounded-xs",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <div
        className={`h-full animate-meter transition-clip ${tone}`}
        style={{ clipPath: `inset(0 ${hidden}% 0 0${rounded ? " round 9999px" : ""})` }}
      />
    </div>
  );
}
