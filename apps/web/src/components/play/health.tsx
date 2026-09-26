"use client";

import type { Condition, Health } from "@odyssai/schemas";
import { useTranslations } from "next-intl";

import { Meter } from "@/components/ui/meter";
import { Tag } from "@/components/ui/panel";

/*
  La jauge de vie.

  Le joueur voit le chiffre, le meneur n'a reçu qu'un mot : c'est la même règle
  que le dé, et pour la même raison. Un meneur qui lirait « 7 sur 16 »
  narrerait une comptabilité.

  Elle ne se règle pas d'ici : le code décide de ce qui l'entame et de ce qui
  la rend, cet écran ne fait que la montrer.
*/
const TONE: Record<Condition, { bar: string; tag: "accent" | "brass" | "ember" }> = {
  indemne: { bar: "bg-accent", tag: "accent" },
  blesse: { bar: "bg-brass", tag: "brass" },
  mal_en_point: { bar: "bg-ember", tag: "ember" },
  a_terre: { bar: "bg-ember", tag: "ember" },
};

export function HealthBar({
  health,
  // Ce que le dernier tour a coûté. Absent tant qu'aucun coup n'a été pris.
  harm,
  hit,
}: {
  health: Health;
  harm?: number;
  // Change à chaque coup reçu : le coût se redit même s'il est le même.
  hit?: number;
}) {
  const t = useTranslations("Game");
  const tone = TONE[health.condition];
  const share = Math.round((health.hp / health.hpMax) * 100);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <Tag tone={tone.tag}>{t(`condition.${health.condition}` as never)}</Tag>
        <span className="text-ui-sm tabular-nums text-vellum-2">
          {t("healthCount", { hp: health.hp, hpMax: health.hpMax })}
        </span>
      </div>

      <Meter value={share} tone={tone.bar} className="mt-2.5" />

      {harm !== undefined && harm > 0 ? (
        <p key={hit} className="mt-2 animate-pop text-caption text-ember">
          {t("harm", { harm })}
        </p>
      ) : null}
    </div>
  );
}
