/*
  L'attente, quand rien ne se diffuse. Un flux se voit au fil de l'eau ; une
  extraction ou une génération se voit par ce cercle, et par rien d'autre.

  `motion-safe` : quelqu'un qui a coupé les animations ne doit pas en subir
  une, et le texte à côté dit déjà qu'on attend.
*/
export function Spinner({ label, className = "" }: { label: string; className?: string }) {
  return (
    <span role="status" className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-4 w-4 shrink-0 motion-safe:animate-spin text-accent"
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
      <span className="text-ui-sm text-vellum-2">{label}</span>
    </span>
  );
}
