"use client";

import { GenerationStepSchema } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { watchGeneration } from "@/lib/world";

/*
  Les étapes du graphe, dans leur ordre d'exécution. Reprises du schéma
  partagé plutôt que recopiées : une étape ajoutée au graphe doit se voir ici
  sans qu'on y pense, et `arc` avait justement pris la recopie en défaut.
*/
const STEPS = GenerationStepSchema.options;

type Step = (typeof STEPS)[number];

interface Props {
  // Appelé quand le monde est prêt : l'assistant relit alors son état.
  onReady: () => void;
}

export function GenerationStep({ onReady }: Props) {
  const t = useTranslations("Play");

  const [step, setStep] = useState<Step | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [lost, setLost] = useState(false);

  // Le flux se ferme de lui-même au bout de dix minutes, et une coupure
  // réseau le ferme plus tôt. On rouvre, plutôt que de laisser le joueur
  // devant un écran qui n'avance plus.
  const [attempt, setAttempt] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;

    const controller = new AbortController();

    watchGeneration((event) => {
      if (event.type === "progress") setStep(event.step);
      if (event.type === "failed") {
        done.current = true;
        setFailed(event.error ?? t("generation.errorUnknown"));
      }
      if (event.type === "ready") {
        done.current = true;
        onReady();
      }
    }, controller.signal)
      .then(() => {
        // Flux terminé sans conclusion : on rouvre.
        if (!done.current && !controller.signal.aborted) {
          setAttempt((current) => current + 1);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLost(true);
      });

    return () => controller.abort();
  }, [attempt, onReady, t]);

  if (failed) {
    return (
      <div className="max-w-headline">
        <h2 className="font-voice text-subtitle text-vellum">
          {t("generation.failedTitle")}
        </h2>
        <p className="mt-3 text-ui-sm text-pretty text-vellum-2">
          {t("generation.failedLead")}
        </p>
        {/* Le détail vient du serveur et reste court : il aide à comprendre
            sans exposer de prompt. */}
        <p className="mt-3 text-ui-sm text-vellum-3">{failed}</p>

        <Button className="mt-6" onClick={onReady}>
          {t("generation.back")}
        </Button>
      </div>
    );
  }

  const current = step ? STEPS.indexOf(step) : -1;

  return (
    <div className="max-w-headline">
      <h2 className="font-voice text-subtitle text-vellum">
        {t("generation.title")}
      </h2>
      <p className="mt-3 text-ui-sm text-pretty text-vellum-2">
        {t("generation.lead")}
      </p>

      <ol className="mt-8 space-y-3" aria-live="polite">
        {STEPS.map((name, index) => {
          const state =
            current === -1
              ? "todo"
              : index < current
                ? "done"
                : index === current
                  ? "current"
                  : "todo";

          return (
            <li key={name} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={[
                  "flex size-5 shrink-0 items-center justify-center rounded-full border text-tag",
                  state === "done"
                    ? "border-accent bg-accent text-on-accent"
                    : state === "current"
                      ? "border-accent text-accent"
                      : "border-line text-vellum-3",
                ].join(" ")}
              >
                {state === "done" ? "✓" : index + 1}
              </span>
              <span
                className={[
                  "text-ui-sm",
                  state === "current" ? "text-vellum" : "text-vellum-3",
                ].join(" ")}
              >
                {t(`generation.steps.${name}`)}
                {state === "current" ? (
                  <span className="text-vellum-3"> …</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-8 text-ui-sm text-vellum-3">
        {lost ? t("generation.lost") : t("generation.leave")}
      </p>
    </div>
  );
}
