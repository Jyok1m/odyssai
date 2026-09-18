"use client";

import { ChartBarSquareIcon } from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
// `next/link` et non le Link de `@/i18n/navigation` : /admin vit hors du
// segment [locale] et hors du proxy next-intl, qui l'exclut de son matcher. Un
// lien localisé pointerait /fr/admin, où rien ne répond.
import Link from "next/link";

import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";

/**
 * L'entrée du tableau de bord, montrée aux seuls administrateurs.
 *
 * Comme le garde d'`AdminShell`, c'est une commodité et jamais une sécurité :
 * `AdminGuard` refuse côté API, et `users.is_admin` ne se pose qu'avec
 * admin:grant. Cacher le bouton évite seulement de proposer une page qui
 * répondrait 403.
 *
 * Rien n'est réservé pendant la lecture de la session, contrairement au bouton
 * de compte : presque personne n'est administrateur, et garder la place ferait
 * un trou dans le header de tous les autres.
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

  return (
    <Button
      as={Link}
      href="/admin"
      variant={stacked ? "secondary" : "ghost"}
      size={size}
      className={stacked ? "w-full" : undefined}
    >
      <ChartBarSquareIcon aria-hidden="true" className="size-4 shrink-0" />
      {t("admin")}
    </Button>
  );
}
