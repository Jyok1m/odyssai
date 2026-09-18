import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Literata } from "next/font/google";
import type { ReactNode } from "react";

import { AdminShell } from "@/components/admin/admin-shell";
import { SessionProvider } from "@/components/auth/session-provider";
import { Toaster } from "@/components/ui/toaster";
import { BRAND_INK } from "@/lib/site";
import "../globals.css";

/**
 * Racine du tableau de bord, distincte de celle du site.
 *
 * `/admin` vit hors du segment `[locale]` et hors du proxy next-intl : un
 * back-office que seul l'administrateur voit n'a pas d'audience anglophone,
 * et le traduire aurait double chaque libellé pour personne. Les textes sont
 * donc en français, en dur.
 *
 * Deux racines coexistent parce qu'aucune `app/layout.tsx` ne les chapeaute :
 * une route statique l'emporte sur `[locale]`, donc `/admin` arrive bien ici
 * et `/fr` va dans l'autre.
 */
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  display: "swap",
});

const literata = Literata({
  variable: "--font-literata",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: BRAND_INK,
  colorScheme: "dark",
};

export const metadata: Metadata = {
  title: "Administration",
  // Un back-office n'a rien à faire dans un index, même protégé.
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="fr"
      className={`${instrumentSans.variable} ${literata.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-ink text-vellum">
        <SessionProvider>
          <AdminShell>{children}</AdminShell>
        </SessionProvider>
        <Toaster />
      </body>
    </html>
  );
}
