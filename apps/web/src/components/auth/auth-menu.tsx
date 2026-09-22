"use client";

import { useTranslations } from "next-intl";
import type { SVGProps } from "react";

import { useAuthLinks } from "@/components/auth/auth-links";
import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/*
  Trois états : inconnu pendant la lecture de la session, invitation à se
  connecter, puis accès au compte. `stacked` est la forme du panneau mobile.

  La déconnexion n'est pas ici : elle vit sur la page du compte, où elle n'a
  pas à occuper une place permanente à côté de la navigation.
*/
export function AuthMenu({
  size = "sm",
  stacked = false,
}: {
  size?: "sm" | "md";
  stacked?: boolean;
}) {
  const t = useTranslations("Auth");
  const tNav = useTranslations("Nav");
  const session = useSession();
  const { signIn } = useAuthLinks();

  if (session.status === "loading") {
    // Réserve la place du bouton, sans quoi le header se réagence dès que
    // l'API répond. Une seule classe de largeur : deux utilitaires sur la même
    // propriété seraient arbitrés par la feuille CSS, pas par className.
    return (
      <div
        aria-hidden="true"
        className={[
          "rounded-control bg-mist motion-safe:animate-pulse",
          size === "sm" ? "h-8" : "h-10",
          stacked ? "w-full" : size === "sm" ? "w-28" : "w-36",
        ].join(" ")}
      />
    );
  }

  if (session.status === "anonymous") {
    // Pas de garde par le drapeau d'alpha : il ne retient que l'entrée en jeu.
    return (
      <Button
        as="a"
        href={signIn}
        variant="secondary"
        size={size}
        className={stacked ? "w-full" : undefined}
      >
        {tNav("login")}
      </Button>
    );
  }

  return (
    <Button
      as={Link}
      href="/compte"
      variant={stacked ? "secondary" : "ghost"}
      size={size}
      title={session.user.email}
      className={stacked ? "w-full" : undefined}
    >
      <AccountIcon aria-hidden="true" className="size-4 shrink-0" />
      {t("account")}
    </Button>
  );
}

/*
  Silhouette de compte. `currentColor` et `viewBox` à 24 comme les icônes de
  marque : la taille et la couleur restent décidées par le parent.
*/
function AccountIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      viewBox="0 0 24 24"
      {...props}
    >
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5a7 7 0 0 1 14 0" />
    </svg>
  );
}
