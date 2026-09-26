import type { MetadataRoute } from "next";

import { BRAND_INK, SITE_NAME } from "@/lib/site";
import { routing } from "@/i18n/routing";
import fr from "../../messages/fr.json";

/*
  Servi sur une URL unique, hors du segment [locale] : il ne peut pas être
  localisé par requête, et prend donc la locale par défaut. Les messages sont
  importés directement parce que `next/root-params`, dont dépend notre
  configuration next-intl, n'est pas utilisable ici.
*/
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: fr.Metadata.title,
    short_name: SITE_NAME,
    description: fr.Metadata.description,
    lang: routing.defaultLocale,
    id: "/",
    // La racine et non /fr : le proxy la redirige selon le cookie de langue
    // puis Accept-Language, l'application installee s'ouvre donc dans la
    // langue choisie.
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: BRAND_INK,
    theme_color: BRAND_INK,
    categories: ["games", "entertainment"],
    icons: [
      {
        src: "/odyssai-mark.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      // Fond plein, sans coins transparents : Android y decoupe sa propre
      // forme, et le dessin tient dans le cercle sur de 80 %.
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
