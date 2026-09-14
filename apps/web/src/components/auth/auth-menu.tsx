"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import toast from "react-hot-toast";

import { useAuthLinks } from "@/components/auth/auth-links";
import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { requestSignOut } from "@/lib/api";

/**
 * Bloc d'authentification du header, en trois états : inconnu pendant la
 * lecture de la session, invitation à se connecter, puis identité du joueur.
 * `stacked` est la forme du panneau mobile.
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
    // Réserve la place du bouton, sans quoi le header se réagence sous le
    // curseur dès que l'API répond. Une seule classe de largeur : deux
    // utilitaires sur la même propriété seraient arbitrés par la feuille CSS
    // et non par l'ordre dans className.
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
    // Sans garde par le drapeau d'alpha : ouvrir un compte est deja possible,
    // le drapeau ne retient plus que l'entree dans le jeu.
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

  // Dans la barre, l'adresse complete pousse la navigation contre le selecteur
  // de langue. La partie locale suffit a reconnaitre son compte ; l'adresse
  // entiere reste dans title et dans le panneau mobile.
  const shortName = session.user.email.split("@")[0];

  return (
    <div
      className={
        stacked ? "space-y-3" : "flex min-w-0 items-center justify-end gap-x-3"
      }
    >
      <span
        title={session.user.email}
        className={[
          "truncate text-ui-sm text-vellum-2",
          // Sous xl, le bouton de deconnexion porte seul l'information.
          stacked ? "block" : "hidden max-w-32 xl:block",
        ].join(" ")}
      >
        {stacked ? session.user.email : shortName}
      </span>
      <Button
        type="button"
        // Bordé sur toute la largeur : un bouton fantôme y passerait pour du
        // texte centré.
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
