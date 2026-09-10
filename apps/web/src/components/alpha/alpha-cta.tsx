"use client";

import { useTranslations } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { ALPHA_OPEN } from "@/lib/flags";

type ButtonStyling = Pick<
  ComponentProps<typeof Button>,
  "variant" | "size" | "className"
>;

/**
 * Appel à l'action gardé par le drapeau d'ouverture de l'alpha. Tant que
 * NEXT_PUBLIC_ALPHA_OPEN ne vaut pas "true", le clic ouvre un toast au lieu
 * de naviguer.
 *
 * `href` reste une chaîne libre et non un chemin typé par next-intl : les
 * destinations d'authentification n'existent pas encore.
 */
export function AlphaCta({
  href,
  children,
  ...styling
}: { href: string; children: ReactNode } & ButtonStyling) {
  const t = useTranslations("Alpha");

  if (ALPHA_OPEN) {
    return (
      <Button as="a" href={href} {...styling}>
        {children}
      </Button>
    );
  }

  return (
    <Button type="button" onClick={() => toast(t("closed"))} {...styling}>
      {children}
    </Button>
  );
}
