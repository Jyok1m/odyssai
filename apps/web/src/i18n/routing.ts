import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
	locales: ["fr", "en"],
	defaultLocale: "fr",
	// Préfixe toujours explicite : /fr et /en. `/` est redirigé par le
	// middleware selon le cookie puis l'en-tête Accept-Language.
	localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
