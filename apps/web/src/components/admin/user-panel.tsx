"use client";

import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import type { AdminUserDetail } from "@odyssai/schemas";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import {
  Badge,
  Empty,
  Feedback,
  StatusBadge,
  date,
  reasonOf,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { FIELD } from "@/components/ui/field";
import { adjustCredits, cancelSubscription, fetchUser } from "@/lib/admin";

import { Confirm } from "./confirm";

interface Props {
  id: string;
  onClose: () => void;
  onChanged: (detail: AdminUserDetail) => void;
}

/**
 * La fiche d'un joueur, en tiroir.
 *
 * En tiroir et non sur une page : on vient de la liste, on y retourne, et la
 * position de lecture ne doit pas se perdre à chaque consultation.
 */
export function UserPanel({ id, onClose, onChanged }: Props) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<"set" | "add">("set");
  const [amount, setAmount] = useState("0");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetchUser(id, controller.signal)
      .then((found) => {
        setDetail(found);
        setAmount(String(found.credits));
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(reasonOf(caught));
      });

    return () => controller.abort();
  }, [id]);

  const submit = async () => {
    const credits = Number.parseInt(amount, 10);
    if (Number.isNaN(credits)) {
      setError("Un nombre entier est attendu.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const updated = await adjustCredits(id, { mode, credits, note });
      setDetail(updated);
      setAmount(String(updated.credits));
      setNote("");
      onChanged(updated);
    } catch (caught: unknown) {
      setError(reasonOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-ink/80 transition-opacity duration-300 ease-linear data-closed:opacity-0"
      />

      <div className="fixed inset-y-0 right-0 flex max-w-full">
        <DialogPanel
          transition
          className="flex w-screen max-w-xl transform flex-col overflow-y-auto border-l border-line bg-abyss transition duration-300 ease-in-out data-closed:translate-x-full"
        >
          <header className="sticky top-0 flex items-start justify-between gap-4 border-b border-line bg-abyss px-6 py-4">
            <div>
              <h2 className="font-voice text-subtitle text-vellum">
                {detail?.username ?? "Joueur"}
              </h2>
              <p className="mt-1 text-caption text-vellum-3">
                {detail?.email ?? "…"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-m-2 p-2 text-vellum-3 hover:text-vellum"
            >
              <span className="sr-only">Fermer</span>
              <XMarkIcon aria-hidden="true" className="size-5" />
            </button>
          </header>

          {!detail ? (
            <Empty>{error ?? "Lecture de la fiche."}</Empty>
          ) : (
            <div className="space-y-8 px-6 py-6">
              <section>
                <dl className="grid grid-cols-2 gap-4">
                  <Cell label="Palier">{detail.planName}</Cell>
                  <Cell label="Statut">
                    <StatusBadge status={detail.status} />
                  </Cell>
                  <Cell label="Réserve">
                    <span className="tabular-nums">
                      {detail.credits}
                      <span className="text-vellum-3"> / {detail.monthly}</span>
                    </span>
                  </Cell>
                  <Cell label="Renouvellement">{date(detail.renewsAt)}</Cell>
                  <Cell label="Mondes">{detail.worldCount}</Cell>
                  <Cell label="Tours joués">{detail.turnCount}</Cell>
                  <Cell label="Coût des modèles">
                    {detail.spentUsd.toFixed(2)} USD
                  </Cell>
                  <Cell label="Inscrit le">{date(detail.createdAt)}</Cell>
                </dl>

                {detail.isAdmin ? (
                  <p className="mt-4">
                    <Badge tone="warn">administrateur</Badge>
                  </p>
                ) : null}
              </section>

              <section>
                <h3 className="font-voice text-ui text-vellum">Ajuster la réserve</h3>
                <p className="mt-1.5 text-caption text-vellum-3">
                  L&apos;écriture part au grand livre, avec le motif. Il est en
                  ajout seul : un solde remis à zéro doit se lire comme un
                  mouvement daté, pas comme un trou.
                </p>

                <form
                  data-focus-ring="container"
                  className="mt-4 space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor="mode" className="sr-only">
                      Poser ou déplacer
                    </label>
                    <select
                      id="mode"
                      value={mode}
                      onChange={(event) =>
                        setMode(event.target.value as "set" | "add")
                      }
                      className={`${FIELD} w-auto`}
                    >
                      <option value="set">Poser à</option>
                      <option value="add">Ajouter</option>
                    </select>

                    <label htmlFor="credits" className="sr-only">
                      Crédits
                    </label>
                    <input
                      id="credits"
                      type="number"
                      inputMode="numeric"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      className={`${FIELD} w-32`}
                    />

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setMode("set");
                        setAmount("0");
                      }}
                    >
                      Remettre à zéro
                    </Button>
                  </div>

                  <div>
                    <label htmlFor="note" className="sr-only">
                      Motif
                    </label>
                    <input
                      id="note"
                      value={note}
                      maxLength={140}
                      placeholder="Motif : geste commercial, abus constaté…"
                      onChange={(event) => setNote(event.target.value)}
                      className={FIELD}
                    />
                  </div>

                  <Button type="submit" disabled={busy || note.trim().length < 3}>
                    {busy ? "Enregistrement." : "Enregistrer"}
                  </Button>
                </form>
              </section>

              {detail.stripeSubscriptionId ? (
                <section>
                  <h3 className="font-voice text-ui text-vellum">Abonnement Stripe</h3>
                  <p className="mt-1.5 text-caption text-vellum-3">
                    Résilier coupe tout de suite, sans remboursement. Le retour
                    au palier libre viendra du webhook, seule source du droit.
                  </p>

                  <div className="mt-4">
                    <Confirm
                      label="Résilier l'abonnement"
                      title="Résilier maintenant"
                      lead={
                        <>
                          L&apos;abonnement de {detail.username ?? detail.email}{" "}
                          prend fin immédiatement. Ce qui a été facturé reste
                          facturé : un remboursement se décide chez Stripe.
                        </>
                      }
                      confirmLabel="Résilier"
                      onConfirm={async () => {
                        try {
                          await cancelSubscription(id);
                          const refreshed = await fetchUser(id);
                          setDetail(refreshed);
                          onChanged(refreshed);
                          toast.success("Abonnement résilié.");
                        } catch (caught: unknown) {
                          setError(reasonOf(caught));
                        }
                      }}
                    />
                  </div>
                </section>
              ) : null}

              <section>
                <h3 className="font-voice text-ui text-vellum">Grand livre</h3>
                {detail.entries.length === 0 ? (
                  <Empty>Aucune écriture.</Empty>
                ) : (
                  <ul className="mt-3 divide-y divide-line/60">
                    {detail.entries.map((entry) => (
                      <li key={entry.id} className="flex items-baseline gap-3 py-2">
                        <span
                          className={`w-16 shrink-0 text-right tabular-nums text-ui-sm ${
                            entry.delta < 0 ? "text-ember" : "text-accent"
                          }`}
                        >
                          {entry.delta > 0 ? "+" : ""}
                          {entry.delta}
                        </span>
                        <span className="text-ui-sm text-vellum-2">{entry.reason}</span>
                        <span className="ml-auto text-caption text-vellum-3">
                          solde {entry.balance} · {date(entry.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <Feedback error={error} />
            </div>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption text-vellum-3">{label}</dt>
      <dd className="mt-1 text-ui-sm text-vellum">{children}</dd>
    </div>
  );
}
