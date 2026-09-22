import { defineRouting } from "next-intl/routing";

/*
  Les clés sont les chemins internes, ceux des dossiers sous app/[locale], et
  ce sont aussi les chemins servis : une seule adresse par page, en anglais,
  sous /fr comme sous /en. Le préfixe de locale porte la langue, le chemin
  porte la page. Les anciennes adresses françaises sont redirigées de façon
  permanente par next.config.ts.
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
    "/concept": "/concept",
    "/universes": "/universes",
    "/multiverse": "/multiverse",
    "/lore": "/lore",
    "/pricing": "/pricing",
    "/glossary": "/glossary",
    "/about": "/about",
    "/terms": "/terms",
    "/contact": "/contact",
    "/legal-notice": "/legal-notice",
    "/privacy": "/privacy",
    "/cookies": "/cookies",
    // Pages privees : absentes du sitemap et en noindex, contrairement a
    // toutes les autres, qui sont publiques.
    "/account": "/account",
    "/play": "/play",
    "/play/stories": "/play/stories",
  },
});

export type Locale = (typeof routing.locales)[number];
export type Pathname = keyof typeof routing.pathnames;
