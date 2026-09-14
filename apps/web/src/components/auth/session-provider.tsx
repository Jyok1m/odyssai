"use client";

import type { SessionUser } from "@odyssai/schemas";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { fetchSession } from "@/lib/api";

/**
 * `loading` n'est pas un détail d'implémentation : les pages sont prérendues,
 * donc la session n'est connue qu'après le premier appel à l'API. L'interface
 * doit pouvoir ne rien affirmer pendant ce temps, plutôt que d'afficher un état
 * anonyme qu'elle démentirait aussitôt.
 */
export type Session =
  | { status: "loading"; user: null }
  | { status: "anonymous"; user: null }
  | { status: "authenticated"; user: SessionUser };

const SessionContext = createContext<Session>({ status: "loading", user: null });

/**
 * Lit la session une fois au montage. Côté navigateur et non au rendu serveur :
 * le cookie appartient à l'origine de l'API et n'arrive jamais dans la requête
 * reçue par Next.
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
        // API injoignable : on retombe sur anonyme, l'interface reste
        // utilisable et la connexion mènera au vrai diagnostic.
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
