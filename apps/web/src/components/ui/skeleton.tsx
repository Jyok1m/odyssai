import type { ReactNode } from "react";

/*
  La place d'un contenu qui arrive, à sa taille : quand il arrive, rien ne
  bouge autour. Le reflet glisse par `translate`, le fond ne se repeint pas.

  Pour une attente sans forme connue (une extraction, une génération), c'est
  toujours `Spinner` : un squelette promet une mise en page.
*/
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`relative block overflow-hidden rounded-control bg-mist ${className}`}
    >
      <span className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-vellum/6 to-transparent" />
    </span>
  );
}

/*
  Un bloc de squelettes, annoncé une fois. Le libellé reste celui qu'on
  lisait avant, pour les lecteurs d'écran : à l'œil, la forme suffit.
*/
export function Loading({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" className={["animate-fade", className].filter(Boolean).join(" ")}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

// Quelques lignes de texte, la dernière plus courte comme un paragraphe.
export function SkeletonLines({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <span className={`block space-y-2.5 ${className}`}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={index === lines - 1 && lines > 1 ? "h-3.5 w-3/5" : "h-3.5 w-full"}
        />
      ))}
    </span>
  );
}
