"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { FIELD_DANGER } from "@/components/ui/field";

// Le même mot que sur le site, pour ne pas avoir deux réflexes à apprendre.
const WORD = "SUPPRIMER";

interface Props {
  label: string;
  title: string;
  lead: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

/*
  Une action sans retour, derrière un mot à taper.

  Jumeau de `ui/danger-action`, dont il ne reprend pas le code : celui-là tire
  ses textes de next-intl, que le tableau de bord n'a pas, étant en français
  seul. L'y brancher pour un unique mot aurait coûté plus cher que ces
  quarante lignes, et aurait fait dépendre un back-office du corpus du site.
*/
export function Confirm({ label, title, lead, confirmLabel, onConfirm }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  const ready = typed.trim().toUpperCase() === WORD;

  return (
    <form
      data-focus-ring="container"
      className="rounded-card border border-ember/40 bg-ember/8 p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!ready || busy) return;

        setBusy(true);
        try {
          await onConfirm();
          setOpen(false);
          setTyped("");
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="font-voice text-ui text-vellum">{title}</p>
      {/* Les conséquences avant le champ : les lire après ne sert plus. */}
      <div className="mt-2 text-ui-sm text-vellum-2">{lead}</div>

      <label htmlFor="confirmation" className="mt-4 block text-caption text-vellum-3">
        Tape {WORD} pour confirmer.
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          id="confirmation"
          autoFocus
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          className={FIELD_DANGER}
        />
        <Button type="submit" variant="danger" disabled={!ready || busy}>
          {busy ? "En cours." : confirmLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
        >
          Annuler
        </Button>
      </div>
    </form>
  );
}
