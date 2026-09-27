import type { ReactNode } from "react";

/*
  La place d'un contenu qui arrive, à sa taille : quand il arrive, rien ne
  bouge autour. Le reflet glisse par `translate`, le fond ne se repeint pas,
  et part après celui du bloc voisin (`shimmer-wave`). Rangé hors du bloc au
  repos : sous mouvement réduit, aucune bande figée au milieu.

  Pour une attente sans forme connue (une extraction, une génération), c'est
  toujours `Spinner` : un squelette promet une mise en page.
*/
// L'arrondi en propriété : deux utilitaires de rayon sur un même élément
// seraient arbitrés par la feuille, pas par l'ordre des classes.
const ROUND = {
  control: "rounded-control",
  card: "rounded-card",
  full: "rounded-full",
} as const;

export function Skeleton({
  className = "",
  round = "control",
}: {
  className?: string;
  round?: keyof typeof ROUND;
}) {
  return (
    <span
      aria-hidden="true"
      className={`shimmer-wave relative block overflow-hidden bg-mist ${ROUND[round]} ${className}`}
    >
      <span className="absolute inset-0 -translate-x-full animate-shimmer bg-linear-to-r from-transparent via-vellum/6 to-transparent" />
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

/*
  Une page de panneaux : un titre, puis une rangée de trois blocs. La forme
  commune de la fiche, du livre du monde et du compte.
*/
export function PageSkeleton({ label }: { label: string }) {
  return (
    <Loading label={label} className="space-y-5">
      <Skeleton className="h-40" round="card" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Skeleton className="h-56" round="card" />
        <Skeleton className="h-56" round="card" />
        <Skeleton className="h-56" round="card" />
      </div>
    </Loading>
  );
}
