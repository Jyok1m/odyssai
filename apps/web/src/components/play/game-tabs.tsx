"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";

const TABS = [
  { key: "play", href: "/play" },
  { key: "stories", href: "/play/stories" },
] as const;

// Deux onglets au-dessus du jeu : la table, et la gestion des histoires.
export function GameTabs() {
  const t = useTranslations("Stories.tabs");
  const pathname = usePathname();

  return (
    <nav aria-label={t("label")} className="flex gap-x-6 border-b border-line">
      {TABS.map((tab) => {
        const active = pathname === tab.href;

        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={[
              "-mb-px border-b-2 pb-3 text-ui-sm font-medium transition-colors",
              active
                ? "border-accent text-vellum"
                : "border-transparent text-vellum-2 hover:text-vellum",
            ].join(" ")}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
