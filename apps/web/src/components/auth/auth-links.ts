"use client";

import { useLocale } from "next-intl";

import { getPathname, usePathname } from "@/i18n/navigation";
import { signInUrl, signUpUrl } from "@/lib/api";

/**
 * Les deux entrées du flot Keycloak, pour la page courante. `usePathname` rend
 * le chemin interne, `getPathname` le retraduit en chemin public localisé :
 * c'est lui qu'il faut donner à l'API, sans quoi un retour depuis
 * /en/universes viserait /univers, qui n'existe pas.
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
