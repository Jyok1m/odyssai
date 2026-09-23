"use client";

import type { AlphaStatus } from "@odyssai/schemas";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { useSession } from "@/components/auth/session-provider";
import { fetchAlphaStatus } from "@/lib/alpha";

/*
  L'état de l'alpha, lu une fois par page et partagé : le bandeau, le hero,
  les liens vers le jeu et les pages de jeu en dépendent, et chacun le
  relisait pour son compte.

  `failed` distingue une API muette d'une réponse pas encore arrivée. Dans le
  premier cas on laisse passer : c'est l'API qui tient la règle, et elle dira
  non elle-même.
*/
interface Alpha {
  status: AlphaStatus | null;
  failed: boolean;
}

const AlphaContext = createContext<Alpha>({ status: null, failed: false });

export function AlphaProvider({ children }: { children: ReactNode }) {
  const [alpha, setAlpha] = useState<Alpha>({ status: null, failed: false });

  useEffect(() => {
    const controller = new AbortController();

    fetchAlphaStatus(controller.signal)
      .then((status) => setAlpha({ status, failed: false }))
      .catch(() => {
        if (!controller.signal.aborted) setAlpha({ status: null, failed: true });
      });

    return () => controller.abort();
  }, []);

  return <AlphaContext value={alpha}>{children}</AlphaContext>;
}

export function useAlpha(): Alpha {
  return useContext(AlphaContext);
}

export type GameAccess = "loading" | "open" | "closed";

/*
  Entrer en jeu, ou non. La phase décide, un administrateur passe toujours,
  comme côté API, et tant que l'un des deux n'est pas connu on ne dit rien :
  un administrateur qui lirait « fermé » une seconde y verrait une panne.
*/
export function useGameAccess(): GameAccess {
  const { status, failed } = useAlpha();
  const session = useSession();

  if (status === null) return failed ? "open" : "loading";
  if (status.phase === "open") return "open";
  if (session.status === "loading") return "loading";

  return session.user?.isAdmin ? "open" : "closed";
}
