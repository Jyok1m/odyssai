"use client";

import type { SessionUser } from "@odyssai/schemas";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { fetchSession } from "@/lib/api";

/**
 * `loading` n'est pas un détail : les pages sont prérendues, la session n'est
 * connue qu'après le premier appel à l'API, et l'interface doit pouvoir ne rien
 * affirmer entre-temps plutôt qu'afficher un état anonyme qu'elle démentirait.
 */
export type Session =
  | { status: "loading"; user: null }
  | { status: "anonymous"; user: null }
  | { status: "authenticated"; user: SessionUser };

/**
 * Next répond avant que Nest ait fini de compiler : environ une seconde et
 * demie mesurée sur un démarrage à froid. Ces reprises couvrent ce trou sans
 * faire patienter longtemps quand l'API est vraiment absente.
 */
const RETRY_DELAYS_MS = [400, 900, 1800];

const SessionContext = createContext<Session>({ status: "loading", user: null });

/**
 * Côté navigateur et non au rendu serveur : le cookie appartient à l'origine de
 * l'API et n'arrive jamais dans la requête reçue par Next.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({
    status: "loading",
    user: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          const state = await fetchSession(controller.signal);
          setSession(
            state.authenticated
              ? { status: "authenticated", user: state.user }
              : { status: "anonymous", user: null },
          );
          return;
        } catch (error: unknown) {
          if (controller.signal.aborted) return;

          // L'échec le plus courant est passager : en développement l'API
          // compile encore quand Next sert déjà la page, et en production un
          // hoquet réseau ferait passer un joueur connecté pour un anonyme
          // jusqu'à ce qu'il recharge.
          const delay = RETRY_DELAYS_MS[attempt];
          if (delay !== undefined) {
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          // API toujours injoignable : anonyme, l'interface reste utilisable.
          console.error("lecture de la session impossible", error);
          setSession({ status: "anonymous", user: null });
        }
      }
    };

    void load();
    return () => controller.abort();
  }, []);

  return <SessionContext value={session}>{children}</SessionContext>;
}

export function useSession(): Session {
  return useContext(SessionContext);
}
