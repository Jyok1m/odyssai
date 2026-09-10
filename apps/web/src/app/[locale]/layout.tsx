import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Literata } from "next/font/google";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";

import { JsonLd } from "@/components/seo/json-ld";
import { Toaster } from "@/components/ui/toaster";
import { routing } from "@/i18n/routing";
import { OG_LOCALE, SITE_URL, alternatesFor } from "@/lib/seo";
import { BRAND_INK, SITE_NAME } from "@/lib/site";
import "../globals.css";

/** L'interface et le joueur. */
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  display: "swap",
});

/** Le narrateur. L'axe optique adapte le dessin à la taille rendue. */
const literata = Literata({
  variable: "--font-literata",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: BRAND_INK,
  // Le kit n'a qu'un thème. On le déclare pour que les contrôles natifs et
  // les barres de défilement suivent, au lieu de rester en clair.
  colorScheme: "dark",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    return {};
  }

  const t = await getTranslations({ locale, namespace: "Metadata" });
  const title = t("title");
  const description = t("description");

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: title,
      template: `%s · ${SITE_NAME}`,
    },
    description,
    applicationName: SITE_NAME,
    alternates: alternatesFor(locale),
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      url: `${SITE_URL}/${locale}`,
      locale: OG_LOCALE[locale],
      alternateLocale: routing.locales
        .filter((l) => l !== locale)
        .map((l) => OG_LOCALE[l]),
      title,
      description,
      images: [
        {
          url: "/og/odyssai-og.png",
          width: 1200,
          height: 630,
          alt: SITE_NAME,
          type: "image/png",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og/odyssai-og.png"],
    },
    icons: {
      icon: [
        { url: "/odyssai-mark.svg", type: "image/svg+xml" },
        { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      ],
      shortcut: "/favicon.ico",
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    },
    manifest: "/manifest.webmanifest",
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    formatDetection: { telephone: false, address: false, email: false },
    category: "games",
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;

  // Le segment [locale] attrape aussi les chemins inconnus, on revalide donc.
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  return (
    <html
      lang={locale}
      className={`${instrumentSans.variable} ${literata.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-ink text-vellum">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <Toaster />
        <JsonLd locale={locale} />
      </body>
    </html>
  );
}
