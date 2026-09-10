import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { locale as localeRootParam } from "next/root-params";

import { routing } from "./routing";

export default getRequestConfig(async () => {
  // `next/root-params` remplace `requestLocale`, déprécié en next-intl 4.14.
  // La valeur peut être absente hors du segment [locale] (page 404 racine),
  // et le segment agit en catch-all, donc on revalide systématiquement.
  const requested = await localeRootParam();
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
