"use client";

import type { AlphaPhase, AlphaStatus } from "@odyssai/schemas";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { Badge, Feedback, Panel, reasonOf } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { fetchAdminAlpha, updateAlpha } from "@/lib/alpha";

const PHASES: { id: AlphaPhase; label: string; hint: string }[] = [
  {
    id: "preregistration",
    label: "Fermé, en pré-inscriptions",
    hint: "Les joueurs inscrits attendent : les liens vers le jeu répondent par un toast, l'api refuse les routes de jeu. Le site annonce que l'alpha démarrera avec ses joueurs et compte les places.",
  },
  {
    id: "open",
    label: "Ouvert",
    hint: "Les joueurs entrent en partie. Le site annonce une alpha en cours, toujours avec le compte des places.",
  },
];

/*
  L'état de l'alpha : ce qu'on annonce, et si le jeu est ouvert. La même
  phase fait les deux, parce qu'annoncer une alpha en cours dont les portes
  seraient fermées ferait mentir le site.

  Deux phases seulement. « Complète » n'est pas un choix : c'est le constat
  que les places sont prises, et il s'affiche ici sans pouvoir se régler. Un
  tableau de bord qui pourrait annoncer des places déjà occupées ferait mentir
  le site, et c'est la porte d'entrée qui trancherait, pas l'annonce.
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

  const save = async (patch: { phase?: AlphaPhase; notice?: boolean }) => {
    setBusy(true);
    try {
      setStatus(await updateAlpha(patch));
      toast.success("Ouverture mise à jour.");
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
        status.full ? (
          <Badge tone="warn">complète</Badge>
        ) : (
          <Badge tone="accent">
            {status.remaining} / {status.seats} places
          </Badge>
        )
      }
    >
      <div className="space-y-5 px-4 py-5 sm:px-6">
        <p className="max-w-prose text-ui-sm text-vellum-2">
          {status.taken} joueurs inscrits sur {status.seats}. Au delà, l&apos;api
          refuse de provisionner : ce compte n&apos;est pas un affichage, c&apos;est la
          porte d&apos;entrée.
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
                <span className="mt-0.5 block text-caption text-vellum-3">
                  {phase.hint}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <p className="max-w-prose text-caption text-vellum-3">
          Un administrateur entre en jeu quelle que soit la phase : c&apos;est ainsi
          qu&apos;on vérifie la production avant d&apos;ouvrir.
        </p>

        {status.full ? (
          <p className="max-w-prose text-caption text-brass">
            Les places étant prises, le bandeau annonce une alpha complète quelle
            que soit la phase choisie.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void save({ notice: !status.notice })}
          >
            {status.notice ? "Masquer le bandeau" : "Afficher le bandeau"}
          </Button>
          <span className="text-caption text-vellum-3">
            {status.notice
              ? "Le bandeau est visible sur tout le site."
              : "Le bandeau est masqué. Un refus d'inscription s'affiche quand même."}
          </span>
        </div>
      </div>
    </Panel>
  );
}
