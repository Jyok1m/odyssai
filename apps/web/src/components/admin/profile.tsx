"use client";

import type { PlayerProfile } from "@odyssai/schemas";
import { createContext, useContext, type ReactNode } from "react";

/*
  Qui administre, à la disposition des écrans.

  `AdminShell` lit déjà le profil pour son garde de confort : le repasser ici
  évite un second appel à `/me` juste pour savoir quelle fiche est la mienne.
  L'écran des joueurs s'en sert pour ne pas proposer de se supprimer soi-même,
  ce que l'API refuse de toute façon.
*/
const AdminProfile = createContext<PlayerProfile | null>(null);

export function AdminProfileProvider({
  profile,
  children,
}: {
  profile: PlayerProfile;
  children: ReactNode;
}) {
  return <AdminProfile value={profile}>{children}</AdminProfile>;
}

// Nul hors de la coque, ce qui n'arrive pas : elle attend le profil pour rendre.
export function useAdminProfile(): PlayerProfile | null {
  return useContext(AdminProfile);
}
