import type messages from "../messages/fr.json";
import type { routing } from "@/i18n/routing";

// Rend les clés de traduction et les locales vérifiables à la compilation :
// `t("Hero.titre")` devient une erreur tsc, plus un trou à l'exécution.
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
