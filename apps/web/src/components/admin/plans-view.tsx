"use client";

import type { AdminPlan } from "@odyssai/schemas";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import {
  Badge,
  Empty,
  Feedback,
  Page,
  Panel,
  TableFrame,
  Td,
  Th,
  money,
  reasonOf,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { createPlan, fetchPlans, removePlan, updatePlan } from "@/lib/admin";

import { Confirm } from "./confirm";
import { PlanForm } from "./plan-form";

export function PlansView() {
  const [plans, setPlans] = useState<AdminPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminPlan | "new" | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchPlans(controller.signal)
      .then(setPlans)
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(reasonOf(caught));
      });

    return () => controller.abort();
  }, []);

  const reload = async () => {
    try {
      setPlans(await fetchPlans());
    } catch (caught: unknown) {
      setError(reasonOf(caught));
    }
  };

  const act = async (run: () => Promise<unknown>, done: string) => {
    setError(null);
    try {
      await run();
      await reload();
      toast.success(done);
    } catch (caught: unknown) {
      setError(reasonOf(caught));
    }
  };

  return (
    <Page
      title="Abonnements"
      lead="Les paliers et leurs dotations. Créer un palier payant crée le produit et le prix chez Stripe."
      actions={
        <Button onClick={() => setEditing("new")} disabled={plans === null}>
          Nouveau palier
        </Button>
      }
    >
      {editing ? (
        <div className="mb-6">
          <PlanForm
            plan={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSubmit={async (values) => {
              await act(
                () =>
                  editing === "new"
                    ? createPlan(values as Parameters<typeof createPlan>[0])
                    : updatePlan(editing.id, values),
                editing === "new" ? "Palier créé." : "Palier modifié.",
              );
              setEditing(null);
            }}
          />
        </div>
      ) : null}

      <Panel>
        {plans === null ? (
          <Empty>Lecture des paliers.</Empty>
        ) : plans.length === 0 ? (
          <Empty>Aucun palier. Le palier libre devrait pourtant exister.</Empty>
        ) : (
          <TableFrame>
            <thead className="border-b border-line">
              <tr>
                <Th>Palier</Th>
                <Th className="text-right">Par mois</Th>
                <Th className="text-right">Bienvenue</Th>
                <Th className="text-right">Montant</Th>
                <Th className="text-right">Abonnés</Th>
                <Th>Stripe</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {plans.map((plan) => (
                <tr key={plan.id} className={plan.archived ? "opacity-60" : ""}>
                  <Td>
                    <span className="flex flex-col">
                      <span className="flex flex-wrap items-center gap-2 text-vellum">
                        {plan.name}
                        {plan.archived ? <Badge>archivé</Badge> : null}
                        {/* Les deux états que la page de tarifs montre au
                            visiteur, rappelés ici pour qu'on sache ce qu'il
                            voit sans quitter le tableau de bord. */}
                        {plan.recommended ? (
                          <Badge tone="accent">mis en avant</Badge>
                        ) : null}
                        {plan.comingSoon ? (
                          <Badge tone="warn">bientôt</Badge>
                        ) : null}
                      </span>
                      <span className="text-caption text-vellum-3">{plan.slug}</span>
                    </span>
                  </Td>
                  <Td className="text-right tabular-nums text-vellum">
                    {plan.monthlyCredits}
                  </Td>
                  <Td className="text-right tabular-nums">{plan.welcomeCredits}</Td>
                  <Td className="text-right tabular-nums text-vellum">
                    {money(plan.amountCents, plan.currency)}
                  </Td>
                  <Td className="text-right tabular-nums">{plan.subscriberCount}</Td>
                  <Td>
                    {plan.stripePriceId ? (
                      <span className="font-mono text-caption text-vellum-3">
                        {plan.stripePriceId}
                      </span>
                    ) : (
                      <span className="text-caption text-vellum-3">hors vente</span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <span className="inline-flex flex-wrap items-center justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setEditing(plan)}
                      >
                        Modifier
                      </Button>

                      {/* Archiver retire de la vente sans rien casser :
                          les abonnés en cours gardent leur palier jusqu'à la
                          fin de la période payée. */}
                      {plan.slug !== "free" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void act(
                              () =>
                                updatePlan(plan.id, { archived: !plan.archived }),
                              plan.archived ? "Palier remis en vente." : "Palier archivé.",
                            )
                          }
                        >
                          {plan.archived ? "Remettre en vente" : "Archiver"}
                        </Button>
                      ) : null}

                      {plan.removable ? (
                        <Confirm
                          label="Supprimer"
                          title={`Supprimer ${plan.name}`}
                          lead={
                            <>
                              Personne ne porte ce palier. Le prix et le produit
                              sont désactivés chez Stripe, jamais effacés : les
                              factures passées y renvoient.
                            </>
                          }
                          confirmLabel="Supprimer"
                          onConfirm={() =>
                            act(() => removePlan(plan.id), "Palier supprimé.")
                          }
                        />
                      ) : null}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </Panel>

      <Feedback error={error} />

      <p className="mt-6 max-w-prose text-ui-sm text-vellum-3">
        Un prix Stripe est immuable : changer un montant crée un nouveau prix et
        désactive l&apos;ancien. Les abonnés en cours gardent celui qu&apos;ils
        ont signé jusqu&apos;à leur prochaine facture.
      </p>
    </Page>
  );
}
