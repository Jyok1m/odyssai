import { SITE_NAME } from "@/lib/site";

/**
 * Lockup complet sur fond sombre. Le kit interdit le wordmark sans le
 * symbole, et fixe le logo complet à partir de 120 px de large : à hauteur 32
 * le ratio 364×96 en donne 121.
 *
 * Servi en <img> et non via next/image : l'optimiseur n'apporte rien sur du
 * SVG, et le fichier est déjà l'asset final.
 */
export function OdyssaiLogo({ className = "h-8 w-auto" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG, rien à optimiser
    <img
      src="/odyssai-logo-dark.svg"
      alt={SITE_NAME}
      width={364}
      height={96}
      className={className}
    />
  );
}
