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

import { UserPanel } from "./user-panel";

/** Assez long pour ne pas interroger à chaque touche, assez court pour suivre. */
const SEARCH_DELAY_MS = 300;

export function UsersView() {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async (needle: string, after?: string) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setLoading(true);
    setError(null);

    try {
      const page = await fetchUsers(
        { search: needle || undefined, cursor: after },
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

  const onSearch = (value: string) => {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(value), SEARCH_DELAY_MS);
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
            onClick={() => void load(search, cursor)}
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
