import { WaitingLines, type WaitingContext } from "@/components/motion/waiting-lines";

/*
  L'attente, quand rien ne se diffuse. Un flux se voit au fil de l'eau ; une
  extraction ou une génération se voit par ce cercle, et par rien d'autre.

  `motion-safe` : quelqu'un qui a coupé les animations ne doit pas en subir
  une, et le texte à côté dit déjà qu'on attend.

  Avec `lines`, le texte visible devient les lignes d'attente du contexte,
  et le libellé ne reste que pour les lecteurs d'écran.
*/
export function Spinner({
  label,
  lines,
  className = "",
}: {
  label: string;
  lines?: WaitingContext;
  className?: string;
}) {
  return (
    <span role="status" className={`inline-flex items-center gap-2.5 ${className}`}>
      <SpinnerIcon className="h-4 w-4 text-accent" />
      {lines ? (
        <>
          <span className="sr-only">{label}</span>
          <WaitingLines context={lines} className="text-ui-sm text-vellum-2" />
        </>
      ) : (
        <span className="text-ui-sm text-vellum-2">{label}</span>
      )}
    </span>
  );
}

// Le cercle seul, pour un bouton occupé : son libellé dit déjà quoi.
export function SpinnerIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`shrink-0 motion-safe:animate-spin ${className}`}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="42 18"
      />
    </svg>
  );
}
