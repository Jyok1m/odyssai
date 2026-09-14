"use client";

import { useTranslations } from "next-intl";
import toast from "react-hot-toast";

import { useAuthLinks } from "@/components/auth/auth-links";
import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";

/**
 * Appel à l'action principal. Ouvrir un compte est possible dès maintenant,
 * jouer ne l'est pas : le bouton mène donc à l'inscription Keycloak tant que
 * le joueur est anonyme, et dit l'attente une fois qu'il est connecté.
 *
 * Le drapeau d'ouverture de l'alpha ne garde plus que le jeu, plus le compte.
 */
export function SignupCta({ children }: { children: string }) {
  const t = useTranslations("Alpha");
  const session = useSession();
  const { signUp } = useAuthLinks();

  if (session.status === "authenticated") {
    return (
      <Button type="button" onClick={() => toast(t("closed"))}>
        {children}
      </Button>
    );
  }

  // Pendant la lecture de la session, le lien d'inscription est la bonne
  // réponse pour un visiteur : c'est le cas le plus fréquent, et un joueur
  // déjà connecté verra le bouton basculer avant d'avoir lu la page.
  return (
    <Button as="a" href={signUp}>
      {children}
    </Button>
  );
}
