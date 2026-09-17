"use client";

import { Username } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ProfileError, updateUsername } from "@/lib/profile";

/** `confirming` est la seconde frappe : le pseudo ne se choisit qu'une fois. */
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
    <form
      className="max-w-headline"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2 className="font-voice text-subtitle text-vellum">
        {t("username.title")}
      </h2>
      <p className="mt-3 text-ui-sm text-pretty text-vellum-2">
        {t("username.lead")}
      </p>

      {/* Dit avant la saisie, pas apres : c'est la seule chose que le joueur
          doit savoir avant de taper. */}
      <p className="mt-4 text-ui-sm text-brass">{tAccount("usernameOnce")}</p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <label htmlFor="play-username" className="sr-only">
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
          className="h-10 min-w-0 flex-1 rounded-control border border-line bg-ink px-3.5 font-ui text-ui-sm text-vellum transition-colors focus:border-accent"
        />
        <Button
          type="submit"
          disabled={username.trim().length === 0 || phase === "saving"}
        >
          {phase === "confirming"
            ? tAccount("confirm", { name: username.trim() })
            : t("continue")}
        </Button>
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-ui-sm text-ember">
        {error}
      </p>
    </form>
  );
}

/** Un message par cause : « impossible d'enregistrer » ne dit pas laquelle. */
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
