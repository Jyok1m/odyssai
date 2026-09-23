"use client";

import {
  ATTRIBUTES,
  ATTRIBUTE_MAX,
  ATTRIBUTE_MIN,
  ATTRIBUTE_PIVOT,
  CHARACTER_NAME_MAX,
  CharacterSheetSchema,
  TALENTS_MAX,
  TRAITS_MAX,
  modifierOf,
  type Attributes,
  type CharacterDraft,
} from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/panel";
import { FIELD, FIELD_AREA } from "@/components/ui/field";

interface Props {
  initial: CharacterDraft;
  // Champs que le modèle n'a pas su tirer de la conversation.
  missing: string[];
  saving: boolean;
  error: string | null;
  onSubmit: (character: CharacterDraft) => void;
  // Revenir écrire : la conversation n'est pas close tant qu'on n'a pas validé.
  onBack?: () => void;
}

/*
  Les champs que l'API peut dire manquants. Filtrer dessus type la clé de
  traduction, et évite d'afficher une clé brute si l'API en nommait un autre.
*/
const SHEET_FIELDS = ["name", "gender", "age", "personality", "attributes"] as const;

type SheetField = (typeof SHEET_FIELDS)[number];

function isSheetField(value: string): value is SheetField {
  return (SHEET_FIELDS as readonly string[]).includes(value);
}

const SCORES = Array.from(
  { length: ATTRIBUTE_MAX - ATTRIBUTE_MIN + 1 },
  (_, index) => ATTRIBUTE_MIN + index,
);

/*
  Le socle chiffré, tel qu'il arrive de l'extraction.

  Les cinq attributs sont fixes : le formulaire les pose tous, et aucun ne se
  renomme. Il les laissait nommer librement, hérité du temps où c'était un
  dictionnaire à clés libres, et la fiche ne pouvait alors plus jamais
  valider : le schéma exige ces cinq-là et pas d'autres, sans que rien à
  l'écran ne le dise.
*/
function toAttributes(draft: CharacterDraft): Attributes {
  const written = draft.attributes ?? {};

  return Object.fromEntries(
    ATTRIBUTES.map((name) => [name, written[name] ?? ATTRIBUTE_PIVOT]),
  ) as Attributes;
}

// Le signe compte autant que le chiffre : un malus doit se lire comme un malus.
function signed(modifier: number): string {
  if (modifier === 0) return "0";
  return modifier > 0 ? `+${modifier}` : `−${Math.abs(modifier)}`;
}

export function CharacterSheetForm({
  initial,
  missing,
  saving,
  error,
  onSubmit,
  onBack,
}: Props) {
  const t = useTranslations("Play");
  const tGame = useTranslations("Game");

  const [name, setName] = useState(initial.name ?? "");
  const [gender, setGender] = useState(initial.gender ?? "");
  const [age, setAge] = useState(initial.age ? String(initial.age) : "");
  const [traits, setTraits] = useState(
    (initial.personality?.traits ?? []).join(", "),
  );
  const [summary, setSummary] = useState(initial.personality?.summary ?? "");
  const [attributes, setAttributes] = useState<Attributes>(toAttributes(initial));
  const [talents, setTalents] = useState<string[]>(initial.talents ?? []);
  const [talent, setTalent] = useState("");

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
    attributes,
    talents,
  };

  // Le même schéma que l'API : le bouton répond avant l'aller-retour, et
  // l'API reste seule juge.
  const complete = CharacterSheetSchema.safeParse(draft).success;

  const addTalent = () => {
    const written = talent.trim();
    if (!written || talents.length >= TALENTS_MAX) return;
    if (talents.some((kept) => kept.toLowerCase() === written.toLowerCase())) return;

    setTalents((current) => [...current, written]);
    setTalent("");
  };

  return (
    <form
      data-focus-ring="container"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      {/* Dire ce qui manque plutôt que de laisser chercher le champ vide. */}
      {missing.some(isSheetField) ? (
        <p className="text-ui-sm text-brass">
          {t("sheet.missing", {
            fields: missing
              .filter(isSheetField)
              .map((field) => t(`sheet.fields.${field}`))
              .join(", "),
          })}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-4">
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

        <div className="sm:col-span-4">
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

        <div className="sm:col-span-4">
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

      {/*
        Cinq attributs, et cinq seulement. Le modificateur est dit à côté du
        nom : un chiffre qui ne dit pas ce qu'il fait ne se choisit pas.
      */}
      <fieldset className="mt-6">
        <legend className="text-caption text-vellum-3">
          {t("sheet.attributesLegend", { min: ATTRIBUTE_MIN, max: ATTRIBUTE_MAX })}
        </legend>

        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {ATTRIBUTES.map((attribute) => (
            <li key={attribute}>
              <label
                htmlFor={`sheet-${attribute}`}
                className="flex items-baseline gap-1.5 text-caption text-vellum-2"
              >
                <span className="capitalize">
                  {tGame(`attribute.${attribute}` as never)}
                </span>
                <span className="tabular-nums text-vellum-3">
                  {signed(modifierOf(attributes[attribute]))}
                </span>
              </label>
              <select
                id={`sheet-${attribute}`}
                value={attributes[attribute]}
                onChange={(event) =>
                  setAttributes((current) => ({
                    ...current,
                    [attribute]: Number(event.target.value),
                  }))
                }
                // Pas le FIELD partagé : un select ne prend pas la largeur de
                // la même façon. Le focus reste porté par sa bordure.
                className="mt-1.5 h-10 w-full rounded-control border border-line bg-ink px-3 font-ui text-ui-sm text-vellum transition-colors focus:border-accent"
              >
                {SCORES.map((score) => (
                  <option key={score} value={score}>
                    {score}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </fieldset>

      {/*
        Les talents sont la couleur, là où les attributs sont le calcul. Ils
        n'étaient nulle part dans ce formulaire : l'extraction les remplissait
        et le joueur ne pouvait ni les corriger ni en ajouter.
      */}
      <fieldset className="mt-6">
        <legend className="text-caption text-vellum-3">
          {t("sheet.talentsLegend", { max: TALENTS_MAX })}
        </legend>

        <ul className="mt-3 flex flex-wrap items-center gap-2">
          {talents.map((kept) => (
            <li key={kept}>
              <button
                type="button"
                aria-label={t("sheet.removeTalent", { talent: kept })}
                onClick={() =>
                  setTalents((current) => current.filter((one) => one !== kept))
                }
                className="transition-opacity hover:opacity-70"
              >
                <Tag tone="accent">
                  {kept}
                  <span aria-hidden="true" className="text-vellum-3">
                    {"×"}
                  </span>
                </Tag>
              </button>
            </li>
          ))}
        </ul>

        {talents.length < TALENTS_MAX ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="sheet-talent" className="sr-only">
              {t("sheet.talentsLegend", { max: TALENTS_MAX })}
            </label>
            <input
              id="sheet-talent"
              value={talent}
              maxLength={40}
              placeholder={t("sheet.talentPlaceholder")}
              onChange={(event) => setTalent(event.target.value)}
              onKeyDown={(event) => {
                // Entrée ajoute le talent, elle ne valide pas la fiche.
                if (event.key !== "Enter") return;
                event.preventDefault();
                addTalent();
              }}
              className={`w-48 ${FIELD}`}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={talent.trim().length === 0}
              onClick={addTalent}
            >
              {t("sheet.addTalent")}
            </Button>
          </div>
        ) : null}
      </fieldset>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={!complete || saving}>
          {t("sheet.confirm")}
        </Button>

        {onBack ? (
          <Button type="button" variant="ghost" onClick={onBack}>
            {t("sheet.backToChat")}
          </Button>
        ) : null}

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
