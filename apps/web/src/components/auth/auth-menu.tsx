"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import toast from "react-hot-toast";

import { AlphaCta } from "@/components/alpha/alpha-cta";
import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { getPathname, usePathname } from "@/i18n/navigation";
import { requestSignOut, signInUrl } from "@/lib/api";

/**
 * Bloc d'authentification du header, en trois états : inconnu pendant la
 * lecture de la session, invitation à se connecter, puis identité du joueur.
 *
 * `stacked` sert au panneau mobile, où les deux lignes s'empilent sur toute
 * la largeur au lieu de s'aligner dans la barre.
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
  const locale = useLocale();
  const pathname = usePathname();
  const session = useSession();
  const [leaving, setLeaving] = useState(false);

  if (session.status === "loading") {
    // Réserve la place du bouton : sans ça le header se réagence sous le
    // curseur dès que l'API répond. Une seule classe de largeur : deux
    // utilitaires visant la même propriété seraient arbitrés par la feuille
    // CSS et non par l'ordre dans className.
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
    // `pathname` est dépouillé du préfixe de locale par next-intl, et les
    // segments sont les chemins internes : getPathname reconstruit le chemin
    // public, celui sur lequel Keycloak devra nous ramener.
    const redirectTo = getPathname({ locale, href: pathname });

    return (
      <AlphaCta
        href={signInUrl(redirectTo)}
        variant="secondary"
        size={size}
        className={stacked ? "w-full" : undefined}
      >
        {tNav("login")}
      </AlphaCta>
    );
  }

  const signOut = async () => {
    setLeaving(true);
    try {
      // Navigation en dur et non router.push : la fin de session est une page
      // de Keycloak, hors du site.
      window.location.assign(await requestSignOut());
    } catch (error: unknown) {
      console.error("déconnexion impossible", error);
      toast.error(t("signOutFailed"));
      setLeaving(false);
    }
  };

  return (
    <div
      className={
        stacked ? "space-y-3" : "flex min-w-0 items-center justify-end gap-x-3"
      }
    >
      <span
        title={session.user.email}
        className={[
          "block truncate text-ui-sm text-vellum-2",
          stacked ? "" : "max-w-56",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {session.user.email}
      </span>
      <Button
        type="button"
        // Bordé dans le panneau mobile : sur toute la largeur, un bouton
        // fantôme ne se distingue plus d'une ligne de texte centrée.
        variant={stacked ? "secondary" : "ghost"}
        size={size}
        onClick={signOut}
        disabled={leaving}
        className={[
          "disabled:cursor-not-allowed disabled:opacity-60",
          stacked ? "w-full" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {t("signOut")}
      </Button>
    </div>
  );
}
