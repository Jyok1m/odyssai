"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { useSession } from "@/components/auth/session-provider";
import { Link } from "@/i18n/navigation";

/*
  Ce qu'on accepte en créant un compte. L'inscription part ensuite chez
  Keycloak : c'est le dernier écran qui nous appartient.

  Rien pour un joueur déjà connecté, qui a accepté en s'inscrivant.
*/
export function SignupTerms() {
  const t = useTranslations("Alpha");
  const session = useSession();

  if (session.status === "authenticated") return null;

  return (
    <p className="mx-auto mt-6 max-w-measure text-caption text-pretty text-vellum-3">
      {t.rich("terms", {
        terms: (chunks: ReactNode) => <Inline href="/terms">{chunks}</Inline>,
        privacy: (chunks: ReactNode) => (
          <Inline href="/privacy">{chunks}</Inline>
        ),
      })}
    </p>
  );
}

function Inline({
  href,
  children,
}: {
  href: "/terms" | "/privacy";
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
