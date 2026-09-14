import { defineRouting } from "next-intl/routing";

/**
 * Les clés sont les chemins internes, ceux des dossiers sous app/[locale].
 * Les valeurs sont les chemins publics, localisés : le proxy réécrit
 * /en/universes vers /en/univers avant le rendu.
 */
export const routing = defineRouting({
  locales: ["fr", "en"],
  defaultLocale: "fr",
  // Préfixe toujours explicite : /fr et /en. `/` est redirigé par le
  // proxy selon le cookie puis l'en-tête Accept-Language.
  localePrefix: "always",
  // Explicite bien que ce soit le défaut : le français est la langue du jeu,
  // et seul un navigateur qui demande l'anglais obtient /en. Tout le reste,
  // y compris une langue non gérée, retombe sur defaultLocale.
  localeDetection: true,
  pathnames: {
    "/": "/",
    "/concept": { fr: "/concept", en: "/concept" },
    "/univers": { fr: "/univers", en: "/universes" },
    "/multivers": { fr: "/multivers", en: "/multiverse" },
    "/lore": { fr: "/lore", en: "/lore" },
    "/glossaire": { fr: "/glossaire", en: "/glossary" },
  },
});

export type Locale = (typeof routing.locales)[number];
export type Pathname = keyof typeof routing.pathnames;
