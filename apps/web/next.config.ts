import path from "node:path";

import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Image Docker minimale : Next émet un serveur autonome avec un
	// node_modules élagué, au lieu d'embarquer tout le workspace pnpm.
	output: "standalone",
	// Sans ça, le traçage des fichiers s'arrête à apps/web et rate les
	// dépendances hissées à la racine du workspace.
	outputFileTracingRoot: path.join(__dirname, "../.."),
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
