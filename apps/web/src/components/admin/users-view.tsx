"use client";

import { MagnifyingGlassIcon } from "@heroicons/react/20/solid";
import type { AdminUserDetail, AdminUserRow } from "@odyssai/schemas";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import {
  Badge,
  Empty,
  Feedback,
  Page,
  Panel,
  StatusBadge,
  TableFrame,
  Td,
  Th,
  date,
  reasonOf,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { FIELD } from "@/components/ui/field";
import { fetchUsers } from "@/lib/admin";

import { MarketingExport } from "./marketing-export";
import { UserPanel } from "./user-panel";

// Assez long pour ne pas interroger à chaque touche, assez court pour suivre.
const SEARCH_DELAY_MS = 300;

export function UsersView() {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async (needle: string, consented: boolean, after?: string) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setLoading(true);
    setError(null);

    try {
      const page = await fetchUsers(
        { search: needle || undefined, optIn: consented || undefined, cursor: after },
        controller.signal,
      );

      // Une page suivante s'ajoute, une recherche remplace : sinon la liste
      // mélangerait deux jeux de résultats.
      setRows((current) => (after ? [...current, ...page.rows] : page.rows));
      setCursor(page.nextCursor);
    } catch (caught: unknown) {
      if (controller.signal.aborted) return;
      setError(reasonOf(caught));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  // Le premier chargement n'appelle pas `load` : celle-ci pose son etat avant
  // d'attendre, ce qui dans un effet declenche un rendu en cascade. Ici les
  // setState vivent dans le callback de la promesse, comme partout ailleurs
  // dans le projet.
  useEffect(() => {
    const controller = new AbortController();
    inFlight.current = controller;

    fetchUsers({}, controller.signal)
      .then((page) => {
        setRows(page.rows);
        setCursor(page.nextCursor);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(reasonOf(caught));
        setLoading(false);
      });

    return () => controller.abort();
  }, []);

  const onOptIn = (value: boolean) => {
    setOptIn(value);
    // Sans delai, contrairement a la recherche : une case ne se tape pas, et
    // attendre trois cents millisecondes apres un clic se voit.
    void load(search, value);
  };

  const onSearch = (value: string) => {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(value, optIn), SEARCH_DELAY_MS);
  };

  // Le détail vient de rendre une ligne à jour : on la remplace sur place
  // plutôt que de recharger, ce qui ferait sauter la position de lecture.
  const onChanged = (detail: AdminUserDetail) => {
    setRows((current) =>
      current.map((row) => (row.id === detail.id ? { ...row, ...detail } : row)),
    );
    toast.success("Enregistré.");
  };

  return (
    <Page
      title="Joueurs"
      lead="Pseudo, adresse, palier et réserve. La recherche porte sur les deux premiers."
    >
      <div
        data-focus-ring="container"
        className="mb-5 flex items-center gap-2 rounded-control border border-line bg-ink px-3 transition-colors focus-within:border-accent"
      >
        <MagnifyingGlassIcon aria-hidden="true" className="size-4 text-vellum-3" />
        <label htmlFor="recherche" className="sr-only">
          Chercher un joueur
        </label>
        <input
          id="recherche"
          value={search}
          placeholder="Pseudo ou adresse"
          onChange={(event) => onSearch(event.target.value)}
          className={`${FIELD} border-0 bg-transparent px-0`}
        />
      </div>

      {/* Le filtre et l'extraction se tiennent cote a cote : on coche pour
          voir qui a consenti, on extrait ce qu'on vient de voir. */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <label className="flex items-center gap-2 text-ui-sm text-vellum-2">
          <input
            type="checkbox"
            checked={optIn}
            onChange={(event) => onOptIn(event.target.checked)}
            className="size-4 accent-accent"
          />
          Consentement aux nouvelles seulement
        </label>

        <MarketingExport />
      </div>

      <Panel>
        {rows.length === 0 ? (
          <Empty>{loading ? "Lecture." : "Aucun joueur ne correspond."}</Empty>
        ) : (
          <TableFrame>
            <thead className="border-b border-line">
              <tr>
                <Th>Joueur</Th>
                <Th>Palier</Th>
                <Th className="text-right">Réserve</Th>
                <Th>Statut</Th>
                <Th>Renouvellement</Th>
                <Th className="text-right">Inscrit</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelected(row.id)}
                  className="cursor-pointer transition-colors hover:bg-mist/40"
                >
                  <Td>
                    <span className="flex flex-col">
                      <span className="flex items-center gap-2 text-vellum">
                        {row.username ?? <em className="text-vellum-3">sans pseudo</em>}
                        {row.isAdmin ? <Badge tone="warn">admin</Badge> : null}
                        {/* Marque ceux qui ont dit oui, jamais ceux qui ont dit
                            non : un refus n'a pas a se signaler dans une liste. */}
                        {row.marketingOptIn ? (
                          <Badge tone="accent">nouvelles</Badge>
                        ) : null}
                      </span>
                      <span className="text-caption text-vellum-3">
                        {row.email}
                        {row.emailVerified ? "" : " (non vérifiée)"}
                      </span>
                    </span>
                  </Td>
                  <Td className="text-vellum">{row.planName}</Td>
                  <Td className="text-right tabular-nums text-vellum">
                    {row.credits}
                    <span className="text-vellum-3"> / {row.monthly}</span>
                  </Td>
                  <Td>
                    <StatusBadge status={row.status} />
                    {row.cancelAtPeriodEnd ? (
                      <span className="ml-2 text-caption text-brass">résiliation prévue</span>
                    ) : null}
                  </Td>
                  <Td>{date(row.renewsAt)}</Td>
                  <Td className="text-right">{date(row.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </Panel>

      {cursor ? (
        <div className="mt-5 flex justify-center">
          <Button
            variant="secondary"
            disabled={loading}
            onClick={() => void load(search, optIn, cursor)}
          >
            {loading ? "Lecture." : "Charger la suite"}
          </Button>
        </div>
      ) : null}

      <Feedback error={error} />

      {selected ? (
        <UserPanel
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={onChanged}
        />
      ) : null}
    </Page>
  );
}
