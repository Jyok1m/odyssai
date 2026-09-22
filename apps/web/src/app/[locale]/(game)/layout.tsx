import type { ReactNode } from "react";

import { SiteHeader } from "@/components/marketing/site-header";

/*
  Coque du jeu. Le bandeau reste, pour que le compte et la langue soient
  joignables ; le pied de page du site vitrine part, il n'a rien à faire sous
  un écran de saisie.
*/
export default function GameLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main>{children}</main>
    </>
  );
}
