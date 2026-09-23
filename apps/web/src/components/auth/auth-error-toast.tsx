"use client";

import { AuthErrorCode } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import toast from "react-hot-toast";

const PARAM = "auth_error";

/*
  L'API renvoie sur l'accueil avec ?auth_error=<code>, retiré aussitôt lu pour
  qu'un rechargement ne rejoue pas l'erreur. Lecture dans `window` et non par
  `useSearchParams` : ce composant vit dans le layout de toutes les pages, que
  ce hook ferait basculer du prérendu statique au rendu dynamique.
*/
export function AuthErrorToast() {
  const t = useTranslations("Auth.errors");

  useEffect(() => {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get(PARAM);
    if (raw === null) return;

    url.searchParams.delete(PARAM);
    window.history.replaceState(null, "", url.toString());

    const parsed = AuthErrorCode.safeParse(raw);
    toast.error(t(parsed.success ? parsed.data : "unknown"));
  }, [t]);

  return null;
}
