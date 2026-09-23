"use client";

import type { AlphaPhase, AlphaStatus } from "@odyssai/schemas";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Badge, Feedback, Panel, reasonOf } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { fetchAdminAlpha, updateAlpha } from "@/lib/alpha";

const PHASES: { id: AlphaPhase; label: string; hint: string }[] = [
  {
    id: "open",
    label: "Ouvert",
    hint: "Tout le monde entre en partie. Le bandeau annonce l'alpha, ses bugs possibles et le bonus des premiers inscrits.",
  },
  {
    id: "preregistration",
    label: "Fermé : maintenance ou remise à zéro",
    hint: "Les joueurs ordinaires voient un toast et une page qui le disent, l'api refuse les routes de jeu. Les comptes restent. Un administrateur entre quand même.",
  },
];

/*
  L'état de l'alpha : ouverte ou fermée, la vente des paliers, et où en sont
  les premiers inscrits. Il n'y a plus de porte : le cent unième entre, il n'a
  simplement pas le bonus.
*/
export function AlphaView() {
  const [status, setStatus] = useState<AlphaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetchAdminAlpha(controller.signal)
      .then(setStatus)
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(reasonOf(caught));
      });

    return () => controller.abort();
  }, []);

  if (error) return <Feedback error={error} />;
  if (!status) return null;

  const save = async (patch: { phase?: AlphaPhase; notice?: boolean; salesOpen?: boolean }) => {
    setBusy(true);
    try {
      setStatus(await updateAlpha(patch));
      toast.success("Réglage enregistré.");
    } catch (caught: unknown) {
      toast.error(reasonOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Alpha"
      actions={
        <Badge tone={status.phase === "open" ? "accent" : "warn"}>
          {status.phase === "open" ? "ouvert" : "fermé"}
        </Badge>
      }
    >
      <div className="space-y-5 px-4 py-5 sm:px-6">
        <p className="max-w-prose text-ui-sm text-vellum-2">
          {status.founders.taken} des {status.founders.seats} premières places sont prises :
          chacune reçoit {status.founders.credits} crédits de plus. Ce n&apos;est pas une
          porte : au-delà, on entre quand même, sans le bonus.
        </p>

        <fieldset className="space-y-3">
          <legend className="text-caption text-vellum-3">Ouverture du jeu</legend>

          {PHASES.map((phase) => (
            <label key={phase.id} className="flex gap-3">
              <input
                type="radio"
                name="alpha-phase"
                checked={status.phase === phase.id}
                disabled={busy}
                onChange={() => void save({ phase: phase.id })}
                className="mt-1 size-4 shrink-0 accent-accent"
              />
              <span className="text-ui-sm text-vellum">
                {phase.label}
                <span className="mt-0.5 block text-caption text-vellum-3">{phase.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void save({ salesOpen: !status.salesOpen })}
          >
            {status.salesOpen ? "Fermer la vente des paliers" : "Ouvrir la vente des paliers"}
          </Button>
          <span className="text-caption text-vellum-3">
            {status.salesOpen
              ? "Les paliers configurés chez Stripe sont en vente."
              : "Fermée le temps de l'alpha : la page des tarifs le dit, l'api refuse l'achat, tout le monde joue sur le palier libre."}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void save({ notice: !status.notice })}
          >
            {status.notice ? "Masquer le bandeau" : "Afficher le bandeau"}
          </Button>
          <span className="text-caption text-vellum-3">
            {status.notice ? "Le bandeau est visible sur tout le site." : "Le bandeau est masqué."}
          </span>
        </div>
      </div>
    </Panel>
  );
}
