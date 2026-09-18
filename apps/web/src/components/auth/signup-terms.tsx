"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { useSession } from "@/components/auth/session-provider";
import { Link } from "@/i18n/navigation";

/**
 * Ce qu'on accepte en créant un compte, dit avant de cliquer.
 *
 * L'inscription part chez Keycloak, dont les pages vivent dans le dépôt
 * d'infrastructure : c'est donc ici, sur le dernier écran qui nous appartient,
 * que la mention doit se trouver. Après le bouton, la personne n'est plus
 * chez nous.
 *
 * Rien pour un joueur déjà connecté : il a accepté en s'inscrivant, et le
 * répéter à chaque visite de l'accueil ne l'informe plus. Pendant la lecture
 * de la session, la mention s'affiche, comme le bouton d'inscription auquel
 * elle se rapporte.
 */
export function SignupTerms() {
  const t = useTranslations("Alpha");
  const session = useSession();

  if (session.status === "authenticated") return null;

  return (
    <p className="mx-auto mt-6 max-w-measure text-caption text-pretty text-vellum-3">
      {t.rich("terms", {
        terms: (chunks: ReactNode) => <Inline href="/conditions">{chunks}</Inline>,
        privacy: (chunks: ReactNode) => (
          <Inline href="/confidentialite">{chunks}</Inline>
        ),
      })}
    </p>
  );
}

function Inline({
  href,
  children,
}: {
  href: "/conditions" | "/confidentialite";
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-vellum-2 underline decoration-line underline-offset-4 transition-colors hover:text-vellum"
    >
      {children}
    </Link>
  );
}
