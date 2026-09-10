import type { ReactNode } from "react";

import { SiteHeader } from "@/components/marketing/site-header";

/**
 * Coque du site vitrine. Le header et le <main> sont ici, et non dans les
 * pages : un <header> descendant de <main> perdrait son rôle ARIA banner.
 * Un futur shell de jeu prendra son propre groupe de routes.
 */
export default function MarketingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main>{children}</main>
    </>
  );
}
