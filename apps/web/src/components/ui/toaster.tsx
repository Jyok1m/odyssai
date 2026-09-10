import { Toaster as HotToaster } from "react-hot-toast";

import { BRAND_INK } from "@/lib/site";

/**
 * Toaster de react-hot-toast habillé aux valeurs `.toast` du kit : fond
 * mist, bordure line, rayon 10 px. Les styles passent par `style` et non par
 * des classes : la librairie applique ses propres styles en ligne, et les
 * surcharger en Tailwind demanderait des `!important` partout.
 */
export function Toaster() {
  return (
    <HotToaster
      position="bottom-center"
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
