"use client";

import { useLocale } from "next-intl";

import { getPathname, usePathname } from "@/i18n/navigation";
import { signInUrl, signUpUrl } from "@/lib/api";

/**
 * Les deux entrées du flot Keycloak, calculées pour la page courante.
 *
 * `usePathname` de next-intl rend le chemin interne, dépouillé du préfixe de
 * locale ; `getPathname` le retraduit en chemin public localisé. C'est lui
 * qu'il faut donner à l'API : depuis /en/universes on revient sur
 * /en/universes, et non sur le chemin interne /univers, qui n'existe pas.
 */
export function useAuthLinks() {
  const locale = useLocale();
  const pathname = usePathname();
  const redirectTo = getPathname({ locale, href: pathname });

  return {
    signIn: signInUrl(redirectTo, locale),
    signUp: signUpUrl(redirectTo, locale),
  };
}
