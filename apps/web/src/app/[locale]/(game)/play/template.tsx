import type { ReactNode } from "react";

/*
  Sous `play` et non sous le groupe : `/play` et ses annexes partagent le
  segment `play`, et un gabarit posé plus haut ne serait pas remonté en
  passant de la table à la fiche.
*/
export default function PlayTemplate({ children }: { children: ReactNode }) {
  return <div className="animate-page">{children}</div>;
}
