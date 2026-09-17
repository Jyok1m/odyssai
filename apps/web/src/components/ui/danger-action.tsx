"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface Props {
  /** Le bouton qui ouvre la demande. */
  label: string;
  title: string;
  lead: string;
  /** Ce qui sera supprimé, et ce qui sera gardé. Dit avant de demander. */
  consequences: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  onConfirm: () => Promise<void>;
  error?: string | null;
}

/**
 * Une action sans retour, derrière un mot à taper.
 *
 * Pas une case à cocher ni un second clic : les deux s'obtiennent par réflexe.
 * Recopier un mot demande de lire, ce qui est le seul moment où l'on peut
 * encore changer d'avis. Les conséquences sont affichées avant le champ, pas
 * après : les lire ensuite ne sert plus à rien.
 */
export function DangerAction({
  label,
  title,
  lead,
  consequences,
  confirmLabel,
  busyLabel,
  onConfirm,
  error,
}: Props) {
  const t = useTranslations("Danger");
  const word = t("word");

  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button variant="danger" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  const ready = typed.trim().toUpperCase() === word;

  return (
    <form
      className="rounded-card border border-ember/40 bg-ember/8 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || busy) return;
        setBusy(true);
        void onConfirm().finally(() => setBusy(false));
      }}
    >
      <h3 className="font-voice text-subtitle text-vellum">{title}</h3>
      <p className="mt-3 max-w-measure text-ui-sm text-pretty text-vellum-2">{lead}</p>

      <div className="mt-4 text-ui-sm text-vellum-2">{consequences}</div>

      <label htmlFor="danger-confirm" className="mt-6 block text-caption text-vellum-3">
        {t("prompt", { word })}
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <input
          id="danger-confirm"
          autoFocus
          value={typed}
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
          className="h-10 w-48 rounded-control border border-line bg-ink px-3.5 font-ui text-ui-sm text-vellum transition-colors focus:border-ember"
        />
        <Button type="submit" variant="danger" disabled={!ready || busy}>
          {busy ? busyLabel : confirmLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
        >
          {t("cancel")}
        </Button>
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-ui-sm text-ember">
        {error}
      </p>
    </form>
  );
}
