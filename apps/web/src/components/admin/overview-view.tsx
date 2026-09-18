"use client";

import type { AdminOverview } from "@odyssai/schemas";
import { useEffect, useState } from "react";

import {
  Badge,
  Empty,
  Feedback,
  Page,
  Panel,
  Stat,
  StatGrid,
  TableFrame,
  Td,
  Th,
  reasonOf,
} from "@/components/admin/ui";
import { fetchOverview } from "@/lib/admin";

export function OverviewView() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchOverview(controller.signal)
      .then(setData)
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(reasonOf(caught));
      });

    return () => controller.abort();
  }, []);

  if (error) {
    return (
      <Page title="Vue d'ensemble">
        <Feedback error={error} />
      </Page>
    );
  }

  if (!data) {
    return (
      <Page title="Vue d'ensemble">
        <Empty>Lecture des chiffres.</Empty>
      </Page>
    );
  }

  return (
    <Page
      title="Vue d'ensemble"
      lead="Les trente derniers jours, sauf mention contraire."
      actions={<StripeBadge data={data} />}
    >
      <StatGrid>
        <Stat name="Joueurs" value={String(data.users)} />
        <Stat
          name="Abonnés payants"
          value={String(data.paying)}
          unit={data.users ? `sur ${data.users}` : undefined}
        />
        <Stat name="Mondes générés" value={String(data.worlds)} />
        <Stat name="Tours joués" value={String(data.turnsLast30Days)} />
      </StatGrid>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <StatGrid>
          <Stat
            name="Crédits en circulation"
            value={String(data.creditsOutstanding)}
            unit="non consommés"
          />
          <Stat
            name="Coût des modèles"
            value={data.spentUsdLast30Days.toFixed(2)}
            unit="USD"
          />
        </StatGrid>

        <Panel title="Répartition par palier">
          {data.byPlan.length === 0 ? (
            <Empty>Aucun palier.</Empty>
          ) : (
            <TableFrame>
              <thead className="border-b border-line">
                <tr>
                  <Th>Palier</Th>
                  <Th className="text-right">Abonnés</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {data.byPlan.map((row) => (
                  <tr key={row.plan}>
                    <Td className="text-vellum">{row.planName}</Td>
                    <Td className="text-right">{row.subscribers}</Td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          )}
        </Panel>
      </div>

      {/* Le rapport entre ce qu'un joueur paie et ce qu'il coûte est la seule
          question qui décide d'un barème. Les deux chiffres sont côte à côte
          pour cette raison. */}
      <p className="mt-6 max-w-prose text-ui-sm text-vellum-3">
        Le coût est celui des appels au modèle, journalisé à chaque appel. Un
        barème se recale sur ce chiffre, jamais sur une intuition.
      </p>
    </Page>
  );
}

function StripeBadge({ data }: { data: AdminOverview }) {
  if (!data.stripeEnabled) return <Badge tone="warn">Stripe absent</Badge>;
  return data.stripeLive ? (
    <Badge tone="danger">Stripe en production</Badge>
  ) : (
    <Badge tone="accent">Stripe en test</Badge>
  );
}
