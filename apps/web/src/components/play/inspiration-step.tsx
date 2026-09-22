"use client";

import {
  OWN_DESCRIPTION_MAX,
  OWN_DESCRIPTION_MIN,
  WORKS_MAX,
  WORK_TITLE_MAX,
  normalizeWorkTitle,
  type InspirationDraft,
  type InspirationMode,
} from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FIELD_AREA } from "@/components/ui/field";

export type SaveStatus = "idle" | "saving" | "saved";

interface Props {
  initial: InspirationDraft | null;
  status: SaveStatus;
  error: string | null;
  onDraft: (draft: InspirationDraft) => void;
  onAdvance: (draft: InspirationDraft) => void;
}

// Les lignes vides ne partent pas : le schéma exige deux caractères.
function filled(works: string[]): string[] {
  return works.map((work) => work.trim()).filter((work) => work.length >= 2);
}

// Marque les répétitions, pas la première occurrence : c'est elle qui reste.
function duplicates(works: string[]): Set<number> {
  const firstSeen = new Map<string, number>();
  const marked = new Set<number>();

  works.forEach((work, index) => {
    const trimmed = work.trim();
    if (trimmed.length < 2) return;

    const key = normalizeWorkTitle(trimmed);
    if (firstSeen.has(key)) marked.add(index);
    else firstSeen.set(key, index);
  });

  return marked;
}

export function InspirationStep({
  initial,
  status,
  error,
  onDraft,
  onAdvance,
}: Props) {
  const t = useTranslations("Play");

  const [mode, setMode] = useState<InspirationMode>(initial?.mode ?? "works");
  const [works, setWorks] = useState<string[]>(
    initial?.mode === "works" && initial.works.length > 0 ? initial.works : [""],
  );
  const [description, setDescription] = useState(
    initial?.mode === "own" ? initial.ownDescription : "",
  );
  // Le premier rendu ne doit rien enregistrer : ce serait réécrire ce qu'on
  // vient de lire, et marquer « enregistré » sans que le joueur ait rien tapé.
  const [touched, setTouched] = useState(false);

  const draft: InspirationDraft =
    mode === "works"
      ? { mode: "works", works: filled(works) }
      : { mode: "own", ownDescription: description.trim() };

  // Le brouillon est un objet neuf à chaque rendu : en dépendre relancerait
  // l'effet en boucle. On passe donc par sa forme sérialisée, qui ne change
  // que s'il change vraiment, et on le relit depuis elle.
  const serialized = JSON.stringify(draft);
  useEffect(() => {
    if (touched) onDraft(JSON.parse(serialized) as InspirationDraft);
  }, [serialized, touched, onDraft]);

  const marked = duplicates(works);
  const complete =
    mode === "works"
      ? filled(works).length > 0 && marked.size === 0
      : description.trim().length >= OWN_DESCRIPTION_MIN;

  const change = (next: () => void) => {
    setTouched(true);
    next();
  };

  return (
    <div data-focus-ring="container" className="max-w-headline">
      <h2 className="font-voice text-subtitle text-vellum">
        {t("inspiration.title")}
      </h2>
      <p className="mt-3 text-ui-sm text-pretty text-vellum-2">
        {t("inspiration.lead")}
      </p>

      {/* Les titres ne servent qu'à dégager des thèmes : le monde généré n'en
          reprendra ni les noms ni les personnages. */}
      <p className="mt-3 text-ui-sm text-pretty text-vellum-3">
        {t("inspiration.privacy")}
      </p>

      <div
        role="tablist"
        aria-label={t("inspiration.title")}
        className="mt-8 inline-flex rounded-control border border-line p-1"
      >
        {(["works", "own"] as const).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={mode === value}
            onClick={() => change(() => setMode(value))}
            className={[
              "rounded-control px-3.5 py-1.5 font-ui text-ui-sm font-medium transition-colors",
              mode === value
                ? "bg-accent text-on-accent"
                : "text-vellum-2 hover:text-vellum",
            ].join(" ")}
          >
            {t(`inspiration.mode.${value}`)}
          </button>
        ))}
      </div>

      {mode === "works" ? (
        <div className="mt-6">
          <p className="text-ui-sm text-vellum-2">{t("inspiration.worksHint")}</p>

          <ul className="mt-4 space-y-3">
            {works.map((work, index) => (
              <li key={index} className="flex items-center gap-3">
                <label htmlFor={`work-${index}`} className="sr-only">
                  {t("inspiration.workLabel", { position: index + 1 })}
                </label>
                <input
                  id={`work-${index}`}
                  value={work}
                  maxLength={WORK_TITLE_MAX}
                  placeholder={t("inspiration.workPlaceholder")}
                  aria-invalid={marked.has(index)}
                  onChange={(event) =>
                    change(() =>
                      setWorks((current) =>
                        current.map((value, position) =>
                          position === index ? event.target.value : value,
                        ),
                      ),
                    )
                  }
                  // Pas le FIELD partage : la couleur de bordure est
                  // conditionnelle, et deux utilitaires visant la meme
                  // propriete sont arbitres par la feuille CSS, pas par
                  // l'ordre dans className. Elle se pose donc une seule fois.
                  className={[
                    "h-10 min-w-0 flex-1 rounded-control border bg-ink px-3.5 font-ui text-ui-sm text-vellum transition-colors focus:border-accent",
                    marked.has(index) ? "border-ember" : "border-line",
                  ].join(" ")}
                />
                {works.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t("inspiration.removeWork")}
                    onClick={() =>
                      change(() =>
                        setWorks((current) =>
                          current.filter((_, position) => position !== index),
                        ),
                      )
                    }
                  >
                    <span aria-hidden="true">×</span>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>

          {works.length < WORKS_MAX ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => change(() => setWorks((current) => [...current, ""]))}
            >
              {t("inspiration.addWork")}
            </Button>
          ) : null}

          {marked.size > 0 ? (
            <p className="mt-4 text-ui-sm text-ember">
              {t("inspiration.duplicate")}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-6">
          <label htmlFor="own-description" className="sr-only">
            {t("inspiration.mode.own")}
          </label>
          <textarea
            id="own-description"
            rows={10}
            value={description}
            maxLength={OWN_DESCRIPTION_MAX}
            placeholder={t("inspiration.ownPlaceholder")}
            onChange={(event) =>
              change(() => setDescription(event.target.value))
            }
            className={FIELD_AREA}
          />
          <p className="mt-2 text-caption text-vellum-3">
            {description.trim().length < OWN_DESCRIPTION_MIN
              ? t("inspiration.ownTooShort", {
                  missing: OWN_DESCRIPTION_MIN - description.trim().length,
                })
              : t("inspiration.ownCount", {
                  count: description.trim().length,
                  max: OWN_DESCRIPTION_MAX,
                })}
          </p>
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Button
          type="button"
          disabled={!complete || status === "saving"}
          onClick={() => onAdvance(draft)}
        >
          {t("continue")}
        </Button>

        {/* Dire que rien ne se perd, plutôt que de le laisser deviner. */}
        <p aria-live="polite" className="text-ui-sm text-vellum-3">
          {status === "saving"
            ? t("saving")
            : status === "saved"
              ? t("saved")
              : t("autosave")}
        </p>
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-ui-sm text-ember">
        {error}
      </p>
    </div>
  );
}
