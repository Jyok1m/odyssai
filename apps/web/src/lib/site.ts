/*
  Constantes de marque, sûres partout : ce module est importé aussi bien
  depuis des composants serveur que client.
*/
import type { Viewport } from "next";

export const SITE_NAME = "OdyssAI";

// Fond du kit : theme-color navigateur et fond de manifeste.
export const BRAND_INK = "#12162b";

/*
  Le viewport des deux racines, le site et le tableau de bord.

  `cover` fait passer la page sous l'encoche et l'indicateur d'accueil : les
  marges `env(safe-area-inset-*)` de `globals.css` rendent ensuite la place
  aux contenus. Une couleur de barre par schema, la meme : la page n'a qu'un
  theme, et un navigateur en clair ne doit pas y poser une barre blanche.

  `interactiveWidget` reste au defaut (`resizes-visual`) : aucune barre fixe
  ne porte de champ, le clavier recouvre la page et le navigateur fait
  defiler le champ actif dans la partie visible.
*/
export const SITE_VIEWPORT: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: BRAND_INK },
    { media: "(prefers-color-scheme: dark)", color: BRAND_INK },
  ],
  // Le kit n'a qu'un theme. On le declare pour que les controles natifs et
  // les barres de defilement suivent, au lieu de rester en clair.
  colorScheme: "dark",
};
