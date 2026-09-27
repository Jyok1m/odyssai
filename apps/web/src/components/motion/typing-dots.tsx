/*
  Quelqu'un écrit : trois points en vague, dès l'envoi, avant le premier
  fragment. Sous mouvement réduit la boucle tombe et il reste une ellipse
  fixe. Décoratifs : ce qui attend se dit dans le texte d'à côté.
*/
export function TypingDots({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`typing-dots inline-flex items-center gap-1 ${className}`}>
      <span className="size-1.5 animate-typing rounded-full bg-current" />
      <span className="size-1.5 animate-typing rounded-full bg-current" />
      <span className="size-1.5 animate-typing rounded-full bg-current" />
    </span>
  );
}
