"use client";

import { Username } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FIELD } from "@/components/ui/field";

import { StepCard } from "./step-card";
import { ProfileError, updateUsername } from "@/lib/profile";

// `confirming` est la seconde frappe : le pseudo ne se choisit qu'une fois.
type Phase = "editing" | "confirming" | "saving";

export function UsernameStep({ onDone }: { onDone: () => void }) {
  const t = useTranslations("Play");
  const tAccount = useTranslations("Account");

  const [username, setUsername] = useState("");
  const [phase, setPhase] = useState<Phase>("editing");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!Username.safeParse(username).success) {
      setError(tAccount("errorInvalid"));
      return;
    }

    // Premiere frappe : on demande confirmation au lieu d'enregistrer.
    if (phase === "editing") {
      setError(null);
      setPhase("confirming");
      return;
    }

    setPhase("saving");
    try {
      await updateUsername(username);
      onDone();
    } catch (caught: unknown) {
      const code = caught instanceof ProfileError ? caught.code : "unknown";
      setError(tAccount(profileErrorKey(code)));
      if (code === "unknown") console.error("pseudo non enregistré", caught);
      setPhase("editing");
    }
  };

  return (
    <StepCard rank={1} label={t("steps.username")} title={t("username.title")}>
      <form
        data-focus-ring="container"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="max-w-measure text-ui-sm text-pretty text-vellum-2">
          {t("username.lead")}
        </p>

        <label htmlFor="play-username" className="mt-5 block text-caption text-vellum-3">
          {tAccount("usernameLabel")}
        </label>
        <input
          id="play-username"
          autoFocus
          value={username}
          maxLength={32}
          onChange={(event) => {
            setUsername(event.target.value);
            // Toute frappe annule la confirmation en cours.
            if (phase === "confirming") setPhase("editing");
            setError(null);
          }}
          className={`mt-1.5 ${FIELD}`}
        />

        {/* Dit avant le bouton, pas apres : c'est la seule chose que le joueur
            doit savoir avant de valider. */}
        <p className="mt-3 text-ui-sm text-brass">{tAccount("usernameOnce")}</p>

        <Button
          type="submit"
          className="mt-4"
          disabled={username.trim().length === 0 || phase === "saving"}
        >
          {phase === "confirming"
            ? tAccount("confirm", { name: username.trim() })
            : t("continue")}
        </Button>

        <p aria-live="polite" className="mt-3 min-h-5 text-ui-sm text-ember">
          {error}
        </p>
      </form>
    </StepCard>
  );
}

// Un message par cause : « impossible d'enregistrer » ne dit pas laquelle.
function profileErrorKey(code: ProfileError["code"]) {
  switch (code) {
    case "username_taken":
      return "errorTaken" as const;
    case "username_locked":
      return "errorLocked" as const;
    case "unreachable":
      return "errorUnreachable" as const;
    case "unauthenticated":
      return "errorSignedOut" as const;
    default:
      return "errorGeneric" as const;
  }
}
