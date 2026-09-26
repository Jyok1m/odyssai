import { Toaster as HotToaster } from "react-hot-toast";

import { BRAND_INK } from "@/lib/site";

/*
  react-hot-toast habillé aux valeurs `.toast` du kit. Par `style` et non par
  des classes : la librairie pose les siens en ligne, et les surcharger en
  Tailwind demanderait des `!important` partout.
*/
export function Toaster() {
  return (
    <HotToaster
      position="bottom-center"
      // Au dessus de l'indicateur d'accueil et hors de l'encoche : le
      // conteneur est fixe, le `padding` du `body` ne l'atteint pas.
      containerStyle={{
        right: "max(16px, env(safe-area-inset-right))",
        bottom: "max(16px, env(safe-area-inset-bottom))",
        left: "max(16px, env(safe-area-inset-left))",
      }}
      toastOptions={{
        duration: 5000,
        style: {
          background: "var(--color-mist)",
          color: "var(--color-vellum)",
          border: "1px solid var(--color-line)",
          borderRadius: "10px",
          padding: "12px 14px",
          fontFamily: "var(--font-ui)",
          fontSize: "14px",
          maxWidth: "34rem",
        },
        iconTheme: {
          primary: "var(--accent)",
          secondary: BRAND_INK,
        },
      }}
    />
  );
}
