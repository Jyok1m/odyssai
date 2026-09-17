"use client";

import type { InspirationDraft, OnboardingState } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuthLinks } from "@/components/auth/auth-links";
import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { OnboardingError, fetchOnboarding, saveOnboarding } from "@/lib/onboarding";

import { InspirationStep, type SaveStatus } from "./inspiration-step";
import { StepRail } from "./step-rail";
import { UsernameStep } from "./username-step";

/** Assez long pour ne pas écrire à chaque touche, assez court pour qu'un
 * onglet fermé juste après la dernière frappe ne perde rien. */
const AUTOSAVE_DELAY_MS = 900;

export function OnboardingWizard() {
  const t = useTranslations("Play");
  const tNav = useTranslations("Nav");
  const session = useSession();
  const { signIn } = useAuthLinks();

  const [state, setState] = useState<OnboardingState | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // Pas de garde « déjà chargé » : en mode strict React monte l'effet deux
  // fois, et un tel garde laisserait la première requête annulée sans la
  // relancer.
  useEffect(() => {
    if (session.status !== "authenticated") return;

    const controller = new AbortController();
    fetchOnboarding(controller.signal)
      .then(setState)
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setFatal(
          caught instanceof OnboardingError && caught.code === "unauthenticated"
            ? t("signedOut")
            : t("errorGeneric"),
        );
      });

    return () => controller.abort();
  }, [session.status, t]);

  /** Après le pseudo : l'étape a changé côté serveur, on la relit. */
  const reload = useCallback(() => {
    fetchOnboarding()
      .then(setState)
      .catch(() => setFatal(t("errorGeneric")));
  }, [t]);

  // Un enregistrement en vol et une minuterie en attente survivraient au
  // démontage : l'un écrirait dans un composant parti, l'autre partirait pour
  // rien.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      inFlight.current?.abort();
    },
    [],
  );

  const commit = useCallback(
    async (draft: InspirationDraft, advance: boolean) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      setStatus("saving");
      setError(null);

      try {
        setState(
          await saveOnboarding(
            { step: "inspiration", inspiration: draft, advance },
            controller.signal,
          ),
        );
        setStatus("saved");
      } catch (caught: unknown) {
        if (controller.signal.aborted) return;

        const code =
          caught instanceof OnboardingError ? caught.code : "unknown";

        // `incomplete` n'est pas une perte : la saisie est écrite, seul le
        // passage à l'étape suivante est refusé.
        if (code === "incomplete") {
          setStatus("saved");
          setError(t("incomplete"));
          return;
        }

        setStatus("idle");
        setError(code === "locked" ? t("locked") : t("errorGeneric"));
      }
    },
    [t],
  );

  const onDraft = useCallback(
    (draft: InspirationDraft) => {
      if (timer.current) clearTimeout(timer.current);
      setStatus("saving");
      timer.current = setTimeout(() => void commit(draft, false), AUTOSAVE_DELAY_MS);
    },
    [commit],
  );

  const onAdvance = useCallback(
    (draft: InspirationDraft) => {
      // La minuterie en attente écrirait la même chose une seconde fois.
      if (timer.current) clearTimeout(timer.current);
      void commit(draft, true);
    },
    [commit],
  );

  if (session.status === "loading") {
    return <p className="text-ui-sm text-vellum-3">{t("loading")}</p>;
  }

  if (session.status === "anonymous") {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-ui-sm text-vellum-2">{t("signedOut")}</p>
        <Button as="a" href={signIn}>
          {tNav("login")}
        </Button>
      </div>
    );
  }

  if (fatal) {
    return <p className="text-ui-sm text-ember">{fatal}</p>;
  }

  if (!state) {
    return <p className="text-ui-sm text-vellum-3">{t("loading")}</p>;
  }

  return (
    <div className="space-y-10">
      <StepRail current={state.step} />

      {state.step === "username" ? (
        <UsernameStep onDone={reload} />
      ) : state.step === "inspiration" ? (
        <InspirationStep
          initial={state.inspiration}
          status={status}
          error={error}
          onDraft={onDraft}
          onAdvance={onAdvance}
        />
      ) : (
        // Les étapes suivantes arrivent avec la conversation de personnage et
        // le graphe de génération. Le parcours s'arrête ici pour l'instant,
        // et il le dit plutôt que d'afficher un écran vide.
        <div className="max-w-headline">
          <h2 className="font-voice text-subtitle text-vellum">
            {t("soon.title")}
          </h2>
          <p className="mt-3 text-ui-sm text-pretty text-vellum-2">
            {t("soon.lead")}
          </p>
        </div>
      )}
    </div>
  );
}
