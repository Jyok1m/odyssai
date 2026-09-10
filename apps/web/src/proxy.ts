import createMiddleware from "next-intl/middleware";

import { routing } from "./i18n/routing";

// Convention `proxy` de Next 16 : `middleware` est déprécié. next-intl
// conserve le nom middleware côté API, seul le nom du fichier change.
export default createMiddleware(routing);

export const config = {
	// Tout sauf les routes d'API, les internals Next et les fichiers statiques.
	matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
