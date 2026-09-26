import type { ReactNode } from "react";

/*
  Un gabarit et non la coquille : il est remonté à chaque navigation, et la
  page qui arrive monte en fondu sous un bandeau qui, lui, ne bouge pas. Une
  entrée seulement, l'App Router ne sait pas retenir la page qui s'en va.
*/
export default function MarketingTemplate({ children }: { children: ReactNode }) {
  return <div className="animate-page">{children}</div>;
}
