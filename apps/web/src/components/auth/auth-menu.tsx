"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import toast from "react-hot-toast";

import { useAuthLinks } from "@/components/auth/auth-links";
import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { requestSignOut } from "@/lib/api";

/**
 * Trois états : inconnu pendant la lecture de la session, invitation à se
 * connecter, puis identité du joueur. `stacked` est la forme du panneau mobile.
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
  const [leaving, setLeaving] = useState(false);

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

  const signOut = async () => {
    setLeaving(true);
    try {
      // Et non router.push : la fin de session est une page de Keycloak.
      window.location.assign(await requestSignOut());
    } catch (error: unknown) {
      console.error("déconnexion impossible", error);
      toast.error(t("signOutFailed"));
      setLeaving(false);
    }
  };

  // L'adresse complète pousserait la navigation contre le sélecteur de langue.
  // Elle reste dans title et dans le panneau mobile.
  const shortName = session.user.email.split("@")[0];

  return (
    <div
      className={
        stacked ? "space-y-3" : "flex min-w-0 items-center justify-end gap-x-3"
      }
    >
      {/* Le nom mene au compte : c'est l'affordance attendue, et elle evite
          un lien de plus dans une barre deja chargee. */}
      <Link
        href="/compte"
        title={session.user.email}
        className={[
          "truncate text-ui-sm text-vellum-2 transition-colors hover:text-accent",
          // Sous xl, le bouton de deconnexion porte seul l'information.
          stacked ? "block" : "hidden max-w-32 xl:block",
        ].join(" ")}
      >
        {stacked ? session.user.email : shortName}
      </Link>
      <Button
        type="button"
        // Bordé : un bouton fantôme passerait pour du texte centré.
        variant={stacked ? "secondary" : "ghost"}
        size={size}
        onClick={signOut}
        disabled={leaving}
        className={["disabled:opacity-60", stacked ? "w-full" : ""]
          .filter(Boolean)
          .join(" ")}
      >
        {t("signOut")}
      </Button>
    </div>
  );
}
