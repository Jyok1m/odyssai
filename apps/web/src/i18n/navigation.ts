import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

/**
 * Équivalents locale-aware des primitives de navigation Next : ils
 * préfixent automatiquement la locale courante. Toujours les préférer à
 * `next/link` et `next/navigation` dans les pages traduites.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
