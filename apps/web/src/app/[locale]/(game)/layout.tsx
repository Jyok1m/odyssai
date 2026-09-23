import type { ReactNode } from "react";

import { GameHeader } from "@/components/play/game-header";

/*
  Coque du jeu. Le bandeau est celui du jeu et non celui du site vitrine : cinq
  pages de vente au-dessus d'une table de jeu ne servent personne, et les
  onglets y trouvent leur place. Le pied de page part pour la même raison.
*/
export default function GameLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <GameHeader />
      <main>{children}</main>
    </>
  );
}
