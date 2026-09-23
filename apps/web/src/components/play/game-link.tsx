"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import toast from "react-hot-toast";

import { useGameAccess } from "@/components/auth/alpha-provider";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/*
  Un lien vers le jeu. Porte fermée, il ne mène nulle part et le dit dans un
  toast au lieu d'ouvrir une page qui le dirait : le joueur garde l'écran où
  il est. La règle est celle de l'API, ceci n'en est que l'annonce.
*/
export function GameLink({
  href,
  variant = "primary",
  className,
  children,
}: {
  href: "/play" | "/play/stories";
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations("Alpha");
  const access = useGameAccess();

  if (access === "closed") {
    return (
      <Button
        type="button"
        variant={variant}
        className={className}
        onClick={() => toast(t("closed"))}
      >
        {children}
      </Button>
    );
  }

  return (
    <Button as={Link} href={href} variant={variant} className={className}>
      {children}
    </Button>
  );
}
