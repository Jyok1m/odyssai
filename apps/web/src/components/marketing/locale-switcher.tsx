"use client";

import { useLocale, useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/**
 * Les noms de langue restent dans leur propre langue : un anglophone tombé
 * sur la version française doit pouvoir reconnaître « English ». Ils ne
 * passent donc pas par les fichiers de messages.
 */
const LOCALE_NAMES = {
  fr: { short: "FR", native: "Français" },
  en: { short: "EN", native: "English" },
} as const;

export function LocaleSwitcher({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const activeLocale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("LocaleSwitcher");

  return (
    <nav
      aria-label={t("label")}
      className={["flex items-center gap-x-1", className]
        .filter(Boolean)
        .join(" ")}
    >
      {routing.locales.map((locale) => {
        const isActive = locale === activeLocale;
        const { short, native } = LOCALE_NAMES[locale];

        return (
          <Link
            key={locale}
            // `pathname` est déjà dépouillé du préfixe de locale par
            // next-intl : on reste donc sur la même page en changeant.
            href={pathname}
            locale={locale}
            lang={locale}
            hrefLang={locale}
            aria-label={
              isActive ? t("current", { language: native }) : native
            }
            aria-current={isActive ? "true" : undefined}
            onClick={onNavigate}
            className={[
              "rounded-control px-2 py-1 text-ui-sm font-medium transition-colors",
              isActive
                ? "bg-mist text-vellum"
                : "text-vellum-3 hover:text-vellum",
            ].join(" ")}
          >
            {short}
          </Link>
        );
      })}
    </nav>
  );
}
