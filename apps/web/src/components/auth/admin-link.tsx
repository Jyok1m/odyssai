"use client";

import { ChartBarSquareIcon } from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
// `next/link` et non le Link de `@/i18n/navigation` : /admin vit hors du
// segment [locale] et hors du proxy next-intl, qui l'exclut de son matcher. Un
// lien localisé pointerait /fr/admin, où rien ne répond.
import Link from "next/link";

import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";

/*
  L'entrée du tableau de bord. Une commodité, jamais une sécurité : `AdminGuard`
  refuse côté API. Cacher le bouton évite d'offrir une page qui répondrait 403.

  Aucune place réservée pendant la lecture de la session : presque personne
  n'est administrateur, et le trou se verrait dans le header des autres.
*/
export function AdminLink({
  size = "sm",
  stacked = false,
}: {
  size?: "sm" | "md";
  stacked?: boolean;
}) {
  const t = useTranslations("Nav");
  const session = useSession();

  if (session.status !== "authenticated" || !session.user.isAdmin) return null;

  // Le texte complet dans le panneau mobile, l'icone seule dans la barre : un
  // mot de treize lettres dans une navigation publique concurrence les pages
  // du site, alors que le tableau de bord ne s'adresse qu'a une personne.
  return (
    <Button
      as={Link}
      href="/admin"
      variant={stacked ? "secondary" : "ghost"}
      size={size}
      title={stacked ? undefined : t("admin")}
      className={stacked ? "w-full" : "px-2"}
    >
      <ChartBarSquareIcon aria-hidden="true" className="size-4.5 shrink-0" />
      <span className={stacked ? undefined : "sr-only"}>{t("admin")}</span>
    </Button>
  );
}
