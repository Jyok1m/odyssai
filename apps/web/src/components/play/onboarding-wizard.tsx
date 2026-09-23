"use client";

import type {
  CharacterDraft,
  InspirationDraft,
  OnboardingState,
  OnboardingUpdate,
} from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { OutOfCredits } from "@/components/billing/out-of-credits";
import { useAuthLinks } from "@/components/auth/auth-links";
import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { OnboardingError, fetchOnboarding, saveOnboarding } from "@/lib/onboarding";

import { CharacterStep } from "./character-step";
import { GenerationStep } from "./generation-step";
import { RestartAction } from "./restart-action";
import { WorldShell } from "./world-shell";
import { InspirationStep, type SaveStatus } from "./inspiration-step";
import { StepRail } from "./step-rail";
import { UsernameStep } from "./username-step";

/*
  Assez long pour ne pas écrire à chaque touche, assez court pour qu'un
  onglet fermé juste après la dernière frappe ne perde rien.
*/
const AUTOSAVE_DELAY_MS = 900;

/*
  Un message par cause. Tout renvoyer sur « impossible d'enregistrer » laisse
  le joueur, et celui qui dépanne, sans rien pour distinguer une API éteinte
  d'une session expirée ou d'une étape désynchronisée.
*/
function saveErrorKey(code: OnboardingError["code"]) {
  switch (code) {
    case "locked":
      return "locked" as const;
    case "unreachable":
      return "errorUnreachable" as const;
    case "unauthenticated":
      return "errorSignedOut" as const;
    case "wrong_step":
    case "validation_error":
      return "errorRefused" as const;
    default:
      return "errorGeneric" as const;
  }
}

export function OnboardingWizard() {
  const t = useTranslations("Play");
  const tNav = useTranslations("Nav");
  const session = useSession();
  const { signIn } = useAuthLinks();

  const [state, setState] = useState<OnboardingState | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // La réserve vide n'est pas une panne : elle se dit en bannière, avec le
  // lien qui permet d'y remédier, et n'occupe pas le champ d'erreur du pas.
  const [empty, setEmpty] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  // Vrai quand le joueur regarde une étape antérieure à celle du serveur.
  const [back, setBack] = useState(false);

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
          t(
            caught instanceof OnboardingError
              ? caught.code === "unauthenticated"
                ? "signedOut"
                : saveErrorKey(caught.code)
              : "errorGeneric",
          ),
        );
      });

    return () => controller.abort();
  }, [session.status, t]);

  // Après le pseudo : l'étape a changé côté serveur, on la relit.
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
    async (update: OnboardingUpdate) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      setStatus("saving");
      setError(null);
      setEmpty(false);

      try {
        setState(await saveOnboarding(update, controller.signal));
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

        // La génération d'un monde est le gros poste du barème : c'est ici
        // que le refus se rencontre le plus souvent.
        if (code === "out_of_credits") {
          setEmpty(true);
          return;
        }

        setError(t(saveErrorKey(code)));
        if (code === "unknown") console.error("enregistrement impossible", caught);
      }
    },
    [t],
  );

  const onDraft = useCallback(
    (draft: InspirationDraft) => {
      if (timer.current) clearTimeout(timer.current);
      setStatus("saving");
      timer.current = setTimeout(
        () => void commit({ step: "inspiration", inspiration: draft, advance: false }),
        AUTOSAVE_DELAY_MS,
      );
    },
    [commit],
  );

  const onAdvance = useCallback(
    (draft: InspirationDraft) => {
      // La minuterie en attente écrirait la même chose une seconde fois.
      if (timer.current) clearTimeout(timer.current);
      void commit({ step: "inspiration", inspiration: draft, advance: true });
    },
    [commit],
  );

  const onCharacter = useCallback(
    (character: CharacterDraft) => {
      void commit({ step: "character", character, advance: true });
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

  // Le monde prêt n'est plus un parcours : il prend tout l'écran, sans titre
  // d'assistant ni fil d'étapes au-dessus de lui.
  if (state.step === "ready") return <WorldShell onRestart={reload} />;

  if (state.step === "generating") {
    return (
      <div className="space-y-10">
        {header(t("title"), t("lead"))}
        <GenerationStep onReady={reload} />
      </div>
    );
  }

  // `failed` rouvre l'inspiration : c'est la seule sortie d'une génération qui
  // n'a pas abouti, et l'API l'accepte en écriture pour cette raison.
  const failedRun = state.step === "failed";

  /*
    L'étape affichée, distincte de celle du serveur, peut reculer : l'API
    accepte d'écrire à son étape ou en deçà, et seul un `advance` déplace
    l'étape côté serveur.
  */
  const showing = back && state.step === "character" ? "inspiration" : state.step;

  return (
    <div className="space-y-10">
      {header(t("title"), t("lead"))}
      <StepRail current={failedRun ? "inspiration" : showing} />

      {empty ? (
        <p className="rounded-card border border-brass/40 bg-brass/8 px-4 py-3 text-ui-sm">
          <OutOfCredits />
        </p>
      ) : null}

      {failedRun ? (
        <p className="rounded-card border border-ember/40 bg-ember/8 px-4 py-3 text-ui-sm text-vellum-2">
          {t("generation.failedLead")}
        </p>
      ) : null}

      {state.step === "username" ? (
        <UsernameStep onDone={reload} />
      ) : showing === "character" ? (
        <CharacterStep
          initial={state.character}
          arrival={state.arrival}
          saving={status === "saving"}
          error={error}
          onAdvance={onCharacter}
        />
      ) : (
        <InspirationStep
          initial={state.inspiration}
          status={status}
          error={error}
          onDraft={onDraft}
          onAdvance={onAdvance}
        />
      )}

      {/* Reculer d'une étape, ou en revenir. La saisie est déjà gardée des
          deux côtés : il ne manquait que le chemin. */}
      {state.step === "character" ? (
        <Button variant="ghost" size="sm" onClick={() => setBack(!back)}>
          {back ? t("backToCharacter") : t("backToInspiration")}
        </Button>
      ) : null}

      {failedRun ? <RestartAction onDone={reload} /> : null}
    </div>
  );
}

// Le titre vit ici et non dans la page : le monde prêt n'en veut pas.
function header(title: string, lead: string) {
  return (
    <header className="max-w-headline">
      <h1 className="font-voice text-display-compact text-balance text-vellum">
        {title}
      </h1>
      <p className="mt-6 max-w-measure text-ui text-pretty text-vellum-2">
        {lead}
      </p>
    </header>
  );
}
