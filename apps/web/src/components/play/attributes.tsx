"use client";

import { ATTRIBUTES, type Attribute, type AttributeStanding } from "@odyssai/schemas";
import { useTranslations } from "next-intl";

/*
  Le socle chiffré, tel qu'il se lit.

  Cinq attributs fixes, de un à cinq, et trois est le milieu : le modificateur
  et l'avancement viennent du serveur, qui seul a `@odyssai/engine` sous la
  main. L'écran ne fait que les montrer.
*/

// Le signe compte autant que le chiffre : un malus doit se lire comme un malus.
function signed(modifier: number): string {
  if (modifier === 0) return "0";
  return modifier > 0 ? `+${modifier}` : `−${Math.abs(modifier)}`;
}

function Pips({ score }: { score: number }) {
  return (
    <span className="flex gap-1" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          className={[
            "h-1.5 w-2.5 rounded-xs",
            index < score ? "bg-accent" : "bg-mist",
          ].join(" ")}
        />
      ))}
    </span>
  );
}

/*
  La forme compacte, celle de la table : une ligne par attribut, le nom, les
  cinq crans, le modificateur. Des lignes et non des cartes : cinq cartes
  dans une colonne de 24rem se chevauchaient, le nom et les crans débordant
  chacun de leur côté. `tested` marque celui que le dernier jet a sollicité.
*/
export function AttributeCells({
  standing,
  tested,
}: {
  standing: Record<Attribute, AttributeStanding>;
  tested?: Attribute | null;
}) {
  const t = useTranslations("Game");

  return (
    <ul className="divide-y divide-line">
      {ATTRIBUTES.map((name) => {
        const cell = standing[name];

        return (
          <li key={name} className="flex items-center justify-between gap-4 py-2">
            <span
              className={[
                "text-ui-sm capitalize",
                tested === name ? "text-accent" : "text-vellum-2",
              ].join(" ")}
            >
              {t(`attribute.${name}` as never)}
            </span>
            <span className="flex items-center gap-3">
              <Pips score={cell.score} />
              <span className="w-6 text-right text-caption tabular-nums text-vellum-2">
                {signed(cell.modifier)}
              </span>
            </span>
            <span className="sr-only">
              {t("attributeScore", { score: cell.score, modifier: signed(cell.modifier) })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/*
  La forme développée, celle de la fiche : le chiffre en grand, et où en est
  la montée. Ce compteur repart à zéro à chaque palier franchi, donc il dit
  ce qui reste à faire, jamais ce qui a été fait depuis toujours.
*/
export function AttributeBlocks({
  standing,
}: {
  standing: Record<Attribute, AttributeStanding>;
}) {
  const t = useTranslations("Game");
  const tSheet = useTranslations("Sheet");

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {ATTRIBUTES.map((name) => {
        const cell = standing[name];
        const share = cell.needed
          ? Math.min(100, Math.round((cell.uses / cell.needed) * 100))
          : 100;

        return (
          <li key={name} className="rounded-card border border-line px-4 py-3.5">
            <p className="text-caption text-vellum-3 capitalize">
              {t(`attribute.${name}` as never)}
            </p>

            <div className="mt-1.5 flex items-baseline justify-between gap-3">
              <span className="font-voice text-title tabular-nums text-vellum">
                {cell.score}
              </span>
              <span className="text-ui-sm tabular-nums text-accent">
                {signed(cell.modifier)}
              </span>
            </div>

            <div className="mt-3 h-1.5 overflow-hidden rounded-xs bg-mist">
              <div
                className={cell.needed ? "h-full bg-brass" : "h-full bg-accent"}
                style={{ width: `${share}%` }}
              />
            </div>
            <p className="mt-1.5 text-caption tabular-nums text-vellum-3">
              {cell.needed
                ? tSheet("progress", { uses: cell.uses, needed: cell.needed })
                : tSheet("progressMax")}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
