"use client";

import { useTranslations } from "next-intl";

import { useGameAccess } from "@/components/auth/alpha-provider";
import { useAuthLinks } from "@/components/auth/auth-links";
import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/*
  Appel à l'action principal. Trois réponses selon l'état : l'inscription pour
  un visiteur, rien pour un joueur connecté tant que l'alpha est fermée, et
  l'entrée en jeu une fois qu'elle est ouverte.
*/
export function SignupCta({ children }: { children: string }) {
  const tPlay = useTranslations("Play");
  const session = useSession();
  const { signUp } = useAuthLinks();
  const access = useGameAccess();

  if (session.status === "authenticated") {
    // Un seul libellé, qu'on commence ou qu'on reprenne : distinguer les deux
    // demanderait de lire le parcours à chaque visite de la page d'accueil,
    // et l'assistant reprend de toute façon là où le joueur s'est arrêté.
    if (access === "open") {
      return (
        <Button as={Link} href="/play">
          {tPlay("enter")}
        </Button>
      );
    }

    // Rien, et non un bouton qui répond « pas encore » : sa place est déjà
    // réservée, `AlphaStanding` le lui dit juste au-dessus, et un bouton qui
    // ne mène nulle part se lit comme une panne.
    return null;
  }

  // Pendant la lecture de la session, l'inscription est la bonne réponse : un
  // joueur déjà connecté verra le bouton basculer avant d'avoir lu la page.
  return (
    <Button as="a" href={signUp}>
      {children}
    </Button>
  );
}
