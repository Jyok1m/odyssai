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

    fetchSession(controller.signal)
      .then((state) => {
        setSession(
          state.authenticated
            ? { status: "authenticated", user: state.user }
            : { status: "anonymous", user: null },
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // API injoignable : anonyme, l'interface reste utilisable.
        console.error("lecture de la session impossible", error);
        setSession({ status: "anonymous", user: null });
      });

    return () => controller.abort();
  }, []);

  return <SessionContext value={session}>{children}</SessionContext>;
}

export function useSession(): Session {
  return useContext(SessionContext);
}
