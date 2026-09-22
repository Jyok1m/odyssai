import path from "node:path";

import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

/*
  Les adresses françaises d'avant le passage aux chemins anglais. Elles ont
  été indexées et partagées : chacune répond par une redirection permanente,
  avec et sans préfixe de locale, puisque x-default les annonçait nues.
*/
const RENAMED_PATHS: Record<string, string> = {
	"/univers": "/universes",
	"/multivers": "/multiverse",
	"/tarifs": "/pricing",
	"/glossaire": "/glossary",
	"/a-propos": "/about",
	"/conditions": "/terms",
	"/mentions-legales": "/legal-notice",
	"/confidentialite": "/privacy",
	"/compte": "/account",
	"/jouer": "/play",
	"/jouer/histoires": "/play/stories",
};

const nextConfig: NextConfig = {
	// Image Docker minimale : Next émet un serveur autonome avec un
	// node_modules élagué, au lieu d'embarquer tout le workspace pnpm.
	output: "standalone",
	// Sans ça, le traçage des fichiers s'arrête à apps/web et rate les
	// dépendances hissées à la racine du workspace.
	outputFileTracingRoot: path.join(__dirname, "../.."),
	allowedDevOrigins: ["127.0.0.1"],
	// Évaluées avant le proxy next-intl : une adresse nue est redirigée vers
	// son nouveau chemin nu, que le proxy préfixe ensuite selon la langue.
	async redirects() {
		return Object.entries(RENAMED_PATHS).flatMap(([from, to]) => [
			{ source: from, destination: to, permanent: true },
			{ source: `/fr${from}`, destination: `/fr${to}`, permanent: true },
		]);
	},
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
