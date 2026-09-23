"use client";

import { GenerationStepSchema } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
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
      /* La bordure dit ce qui s'est passé avant qu'on lise le titre. */
      <Panel
        title={t("generation.failedLabel")}
        className="border-ember/40 lg:max-w-headline"
      >
        <h2 className="font-voice text-title text-balance text-vellum">
          {t("generation.failedTitle")}
        </h2>
        <p className="mt-4 max-w-measure text-ui-sm text-pretty text-vellum-2">
          {t("generation.failedLead")}
        </p>
        {/* Le détail vient du serveur et reste court : il aide à comprendre
            sans exposer de prompt. */}
        <p className="mt-3 text-ui-sm text-vellum-3">{failed}</p>

        <Button className="mt-5" onClick={onReady}>
          {t("generation.back")}
        </Button>
      </Panel>
    );
  }

  const current = step ? STEPS.indexOf(step) : -1;

  return (
    <Panel
      title={t("generation.label")}
      aside={lost ? t("generation.lost") : t("generation.leave")}
    >
      <h2 className="font-voice text-title text-balance text-vellum">
        {t("generation.title")}
      </h2>

      {/*
        Le fil des noeuds, a l'horizontale : neuf etapes en colonne tenaient
        tout l'ecran pour dire qu'on attend, et on les relit a chaque fois.

        Les libelles ne tiennent qu'a partir de `md` : sous cette largeur, la
        colonne fait moins que le plus long mot, et les titres se chevauchent
        d'un pas a l'autre. Plus bas, les pastilles seules et une ligne qui dit
        ou l'on en est : c'est la seule chose qu'on vienne lire.
      */}
      <ol className="mt-6 flex items-start gap-1" aria-live="polite">
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
            <li key={name} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <span aria-hidden="true" className="flex w-full items-center">
                <span
                  className={[
                    "h-px flex-1",
                    index === 0 ? "bg-transparent" : state === "todo" ? "bg-line" : "bg-accent",
                  ].join(" ")}
                />
                <span
                  className={[
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-tag",
                    state === "done"
                      ? "border-accent bg-accent text-on-accent"
                      : state === "current"
                        ? "border-accent text-accent"
                        : "border-line text-vellum-3",
                  ].join(" ")}
                >
                  {state === "done" ? "\u2713" : state === "current" ? "\u25cf" : ""}
                </span>
                <span
                  className={[
                    "h-px flex-1",
                    index === STEPS.length - 1
                      ? "bg-transparent"
                      : state === "done"
                        ? "bg-accent"
                        : "bg-line",
                  ].join(" ")}
                />
              </span>

              <span
                className={[
                  "hidden w-full text-center text-caption text-balance hyphens-auto md:block",
                  state === "current" ? "text-vellum" : "text-vellum-3",
                ].join(" ")}
                aria-current={state === "current" ? "step" : undefined}
              >
                {t(`generation.steps.${name}`)}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Sous `md`, le fil n'a plus de libelles : celui de l'etape en cours
          se dit ici, et lui seul. */}
      <p className="mt-4 text-ui-sm text-vellum md:hidden">
        {current === -1
          ? t("generation.queued")
          : t("generation.at", {
              position: current + 1,
              total: STEPS.length,
              step: t(`generation.steps.${STEPS[current]!}`),
            })}
      </p>

      <p className="mt-6 max-w-measure text-ui-sm text-pretty text-vellum-2">
        {t("generation.lead")}
      </p>
    </Panel>
  );
}
