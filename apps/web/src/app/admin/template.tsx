import type { ReactNode } from "react";

// La vue qui arrive monte en fondu, la navigation du tableau de bord reste.
export default function AdminTemplate({ children }: { children: ReactNode }) {
  return <div className="animate-page">{children}</div>;
}
