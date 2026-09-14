import { SITE_NAME } from "@/lib/site";

/**
 * Lockup complet sur fond sombre. Le kit le réserve aux largeurs d'au moins
 * 120 px : à hauteur 32, le ratio 364×96 en donne 121.
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
