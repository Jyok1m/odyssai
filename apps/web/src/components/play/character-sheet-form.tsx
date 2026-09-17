"use client";

import {
  CHARACTER_NAME_MAX,
  CharacterSheetSchema,
  TRAITS_MAX,
  type CharacterDraft,
} from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FIELD, FIELD_AREA } from "@/components/ui/field";

interface Props {
  initial: CharacterDraft;
  /** Champs que le modèle n'a pas su tirer de la conversation. */
  missing: string[];
  saving: boolean;
  error: string | null;
  onSubmit: (character: CharacterDraft) => void;
}

/**
 * Les champs que l'API peut dire manquants. Filtrer dessus type la clé de
 * traduction, et évite d'afficher une clé brute si l'API en nommait un autre.
 */
const SHEET_FIELDS = ["name", "gender", "age", "personality", "attributes"] as const;

type SheetField = (typeof SHEET_FIELDS)[number];

function isSheetField(value: string): value is SheetField {
  return (SHEET_FIELDS as readonly string[]).includes(value);
}

/** Une ligne d'attribut : un nom, une valeur de 1 à 5. */
interface Attribute {
  key: string;
  value: number;
}

function toAttributes(draft: CharacterDraft): Attribute[] {
  const entries = Object.entries(draft.attributes ?? {});
  return entries.length > 0
    ? entries.map(([key, value]) => ({ key, value }))
    : [{ key: "", value: 3 }];
}

export function CharacterSheetForm({
  initial,
  missing,
  saving,
  error,
  onSubmit,
}: Props) {
  const t = useTranslations("Play");

  const [name, setName] = useState(initial.name ?? "");
  const [gender, setGender] = useState(initial.gender ?? "");
  const [age, setAge] = useState(initial.age ? String(initial.age) : "");
  const [traits, setTraits] = useState(
    (initial.personality?.traits ?? []).join(", "),
  );
  const [summary, setSummary] = useState(initial.personality?.summary ?? "");
  const [attributes, setAttributes] = useState<Attribute[]>(
    toAttributes(initial),
  );

  const draft: CharacterDraft = {
    name: name.trim() || undefined,
    gender: gender.trim() || undefined,
    age: age.trim() ? Number(age) : undefined,
    personality: {
      traits: traits
        .split(",")
        .map((trait) => trait.trim())
        .filter(Boolean)
        .slice(0, TRAITS_MAX),
      summary: summary.trim(),
    },
    attributes: Object.fromEntries(
      attributes
        .filter((attribute) => attribute.key.trim().length > 0)
        .map((attribute) => [attribute.key.trim(), attribute.value]),
    ),
  };

  // Le même schéma que l'API : le bouton répond avant l'aller-retour, et
  // l'API reste seule juge.
  const complete = CharacterSheetSchema.safeParse(draft).success;

  const setAttribute = (index: number, patch: Partial<Attribute>) =>
    setAttributes((current) =>
      current.map((attribute, position) =>
        position === index ? { ...attribute, ...patch } : attribute,
      ),
    );

  return (
    <form
      data-focus-ring="container"
      className="max-w-headline"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      <h3 className="font-voice text-subtitle text-vellum">{t("sheet.title")}</h3>
      <p className="mt-3 text-ui-sm text-pretty text-vellum-2">
        {t("sheet.lead")}
      </p>

      {/* Dire ce qui manque plutôt que de laisser chercher le champ vide. */}
      {missing.some(isSheetField) ? (
        <p className="mt-3 text-ui-sm text-brass">
          {t("sheet.missing", {
            fields: missing
              .filter(isSheetField)
              .map((field) => t(`sheet.fields.${field}`))
              .join(", "),
          })}
        </p>
      ) : null}

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="sheet-name" className="text-caption text-vellum-3">
            {t("sheet.fields.name")}
          </label>
          <input
            id="sheet-name"
            value={name}
            maxLength={CHARACTER_NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            className={`mt-1.5 ${FIELD}`}
          />
        </div>

        <div>
          <label htmlFor="sheet-gender" className="text-caption text-vellum-3">
            {t("sheet.fields.gender")}
          </label>
          <input
            id="sheet-gender"
            value={gender}
            maxLength={40}
            onChange={(event) => setGender(event.target.value)}
            className={`mt-1.5 ${FIELD}`}
          />
        </div>

        <div>
          <label htmlFor="sheet-age" className="text-caption text-vellum-3">
            {t("sheet.fields.age")}
          </label>
          <input
            id="sheet-age"
            type="number"
            inputMode="numeric"
            min={1}
            max={1000}
            value={age}
            onChange={(event) => setAge(event.target.value)}
            className={`mt-1.5 ${FIELD}`}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="sheet-traits" className="text-caption text-vellum-3">
            {t("sheet.fields.personality")}
          </label>
          <input
            id="sheet-traits"
            value={traits}
            placeholder={t("sheet.traitsPlaceholder")}
            onChange={(event) => setTraits(event.target.value)}
            className={`mt-1.5 ${FIELD}`}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="sheet-summary" className="text-caption text-vellum-3">
            {t("sheet.summary")}
          </label>
          <textarea
            id="sheet-summary"
            rows={3}
            value={summary}
            maxLength={500}
            onChange={(event) => setSummary(event.target.value)}
            className={`mt-1.5 ${FIELD_AREA}`}
          />
        </div>
      </div>

      <fieldset className="mt-8">
        <legend className="text-caption text-vellum-3">
          {t("sheet.fields.attributes")}
        </legend>

        <ul className="mt-3 space-y-3">
          {attributes.map((attribute, index) => (
            <li key={index} className="flex items-center gap-3">
              <input
                value={attribute.key}
                maxLength={40}
                aria-label={t("sheet.attributeName", { position: index + 1 })}
                placeholder={t("sheet.attributePlaceholder")}
                onChange={(event) => setAttribute(index, { key: event.target.value })}
                className={FIELD}
              />
              <select
                value={attribute.value}
                aria-label={t("sheet.attributeValue", { position: index + 1 })}
                onChange={(event) =>
                  setAttribute(index, { value: Number(event.target.value) })
                }
                // Pas le FIELD partage : un select ne prend pas la largeur
                // et se serre davantage. Le focus reste porte par sa bordure.
                className="h-10 shrink-0 rounded-control border border-line bg-ink px-3 font-ui text-ui-sm text-vellum transition-colors focus:border-accent"
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              {attributes.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t("sheet.removeAttribute")}
                  onClick={() =>
                    setAttributes((current) =>
                      current.filter((_, position) => position !== index),
                    )
                  }
                >
                  <span aria-hidden="true">×</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>

        {attributes.length < 8 ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() =>
              setAttributes((current) => [...current, { key: "", value: 3 }])
            }
          >
            {t("sheet.addAttribute")}
          </Button>
        ) : null}
      </fieldset>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={!complete || saving}>
          {t("sheet.confirm")}
        </Button>
        {!complete ? (
          <p className="text-ui-sm text-vellum-3">{t("sheet.incomplete")}</p>
        ) : null}
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-ui-sm text-ember">
        {error}
      </p>
    </form>
  );
}
