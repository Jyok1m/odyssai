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
  // Explicite bien que ce soit le défaut : seul un navigateur qui demande
  // l'anglais obtient /en, tout le reste retombe sur defaultLocale.
  localeDetection: true,
  pathnames: {
    "/": "/",
    "/concept": { fr: "/concept", en: "/concept" },
    "/univers": { fr: "/univers", en: "/universes" },
    "/multivers": { fr: "/multivers", en: "/multiverse" },
    "/lore": { fr: "/lore", en: "/lore" },
    "/tarifs": { fr: "/tarifs", en: "/pricing" },
    "/glossaire": { fr: "/glossaire", en: "/glossary" },
    "/mentions-legales": { fr: "/mentions-legales", en: "/legal-notice" },
    "/confidentialite": { fr: "/confidentialite", en: "/privacy" },
    "/cookies": { fr: "/cookies", en: "/cookies" },
    // Pages privees : absentes du sitemap et en noindex, contrairement a
    // toutes les autres, qui sont publiques.
    "/compte": { fr: "/compte", en: "/account" },
    // Le chemin interne est en anglais comme tout le reste du code, le chemin
    // servi reste en francais : le joueur ne voit pas d'anglais dans sa barre
    // d'adresse.
    "/play": { fr: "/jouer", en: "/play" },
  },
});

export type Locale = (typeof routing.locales)[number];
export type Pathname = keyof typeof routing.pathnames;
