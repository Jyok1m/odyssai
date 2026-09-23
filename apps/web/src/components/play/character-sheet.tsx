"use client";

import {
  INVENTORY_MAX,
  type RollRecord,
  type WorldView,
} from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useEffect, useState, type CSSProperties } from "react";

import { AttributeBlocks } from "@/components/play/attributes";
import { Die, Verdict } from "@/components/play/game-chat";
import { HealthBar } from "@/components/play/health";
import { Definition, Panel, Tag } from "@/components/ui/panel";
import { Absent, WorldSkin, useWorld } from "@/components/play/use-world";
import { fetchProfile } from "@/lib/profile";
import { fetchHistory } from "@/lib/turn";

/*
  La fiche de personnage.

  Elle ne montre que ce que le jeu tient vraiment : les cinq attributs, ce
  qu'ils pèsent sur un jet, où en est leur montée, la jauge de vie, les talents
  que le meneur lit, et ce que le personnage porte.

  Ni mana ni niveau ni points d'expérience à côté : le mana n'a de sens que
  dans un monde qui a de la magie, et c'est la charte qui le dit, pas le
  moteur ; l'expérience existe déjà, par attribut et à l'usage. Une jauge que
  rien ne calcule se lirait comme une règle.
*/
export function CharacterSheet() {
  const t = useTranslations("Sheet");
  const state = useWorld();

  if (state.status === "loading") {
    return <p className="text-ui-sm text-vellum-3">{t("loading")}</p>;
  }
  if (state.status === "not_ready") {
    return <Absent message={t("notReady")} />;
  }
  if (state.status === "error") {
    return <p className="text-ui-sm text-ember">{t("error")}</p>;
  }

  return (
    <WorldSkin world={state.world}>
      <Sheet world={state.world} />
    </WorldSkin>
  );
}

function Sheet({ world }: { world: WorldView }) {
  const t = useTranslations("Sheet");
  const tGame = useTranslations("Game");
  const tStories = useTranslations("Stories");

  const [player, setPlayer] = useState<string | null>(null);
  const [roll, setRoll] = useState<RollRecord | null>(null);

  /*
    Le pseudo et le dernier jet viennent d'ailleurs que du monde : l'un du
    profil, l'autre de la partie. Aucun des deux ne doit empêcher la fiche de
    s'afficher, donc leur échec est silencieux.
  */
  useEffect(() => {
    const controller = new AbortController();

    fetchProfile(controller.signal)
      .then((profile) => setPlayer(profile.username))
      .catch(() => {});
    fetchHistory(controller.signal)
      .then((history) => setRoll(history.lastRoll))
      .catch(() => {});

    return () => controller.abort();
  }, []);

  const character = world.character;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-caption tracking-widest text-vellum-3 uppercase">
            {t("title")}
          </p>
          <h1 className="mt-2 font-voice text-display-compact text-balance text-vellum">
            {character.name}
          </h1>
        </div>
        <p className="flex flex-wrap items-center gap-2 text-ui-sm text-vellum-2">
          {/* Comment il est entré ici : né dans ce monde, ou venu d'un autre. */}
          <Tag tone={character.arrival === "natif" ? "muted" : "arcane"}>
            {t(`arrivals.${character.arrival}` as never)}
          </Tag>
          {t("world")}
          <Tag tone="accent">{world.name}</Tag>
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title={t("identity")} aside={player ?? undefined}>
          <div className="flex items-center gap-5">
            <span
              aria-hidden="true"
              style={{ borderRadius: "var(--radius-portal)" }}
              className="grid h-28 w-20 flex-none place-items-center border border-accent/40 bg-mist pt-4 font-voice text-title text-accent sm:h-36 sm:w-28 sm:pt-6 sm:text-display-compact"
            >
              {character.name.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <p className="text-ui-sm text-vellum">
                {character.gender}
                <span className="text-vellum-3">
                  {" · "}
                  {tGame("age", { age: character.age })}
                </span>
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {character.personality.traits.map((trait) => (
                  <li key={trait}>
                    <Tag>{trait}</Tag>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {character.personality.summary ? (
            <p className="mt-5 font-voice text-ui text-pretty text-vellum-2 italic">
              {`« ${character.personality.summary} »`}
            </p>
          ) : null}
        </Panel>

        {/* Ce que le personnage emporterait partout : son caractère et ce qui
            le rattache à cette histoire, qu'il sait. Ce que le monde sait de
            lui et qu'il ignore reste au meneur, et n'est pas dans ce type. */}
        <Panel title={t("essence")}>
          <dl className="divide-y divide-line">
            <Definition term={t("traits")}>
              {character.personality.traits.join(", ") || t("unwritten")}
            </Definition>
            <Definition term={t("summary")}>
              {character.personality.summary || t("unwritten")}
            </Definition>
            {world.story.bond ? (
              <Definition term={t("bond")}>{world.story.bond}</Definition>
            ) : null}
          </dl>
        </Panel>

        {/* La seule jauge que le moteur tient : le code décide de ce qui
            l'entame et de ce qui la rend, jamais le récit. */}
        <Panel title={t("state")} aside={t("stateAside")}>
          <HealthBar health={character.health} />
          <p className="mt-5 max-w-measure text-caption text-pretty text-vellum-3">
            {t("stateHint")}
          </p>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title={t("attributes")} aside={t("attributesAside")} className="lg:col-span-2">
          <AttributeBlocks standing={character.standing} />
          <p className="mt-4 max-w-measure text-caption text-pretty text-vellum-3">
            {t("progressHint")}
          </p>
        </Panel>

        {/* Où en est l'histoire : le rang de l'acte, jamais son but. Un joueur
            qui lirait la fin n'aurait plus qu'à y aller. */}
        <Panel title={t("standing")}>
          <p className="font-voice text-title text-vellum">
            {world.story.act === null || world.story.acts === 0
              ? tGame("noAct")
              : world.story.act > world.story.acts
                ? tGame("free")
                : tGame("act", { act: world.story.act, acts: world.story.acts })}
          </p>
          {/* Le nom de l'acte, jamais son but : le joueur sait ce qu'il
              traverse, pas ce qu'il faut en faire. */}
          {world.story.title ? (
            <p className="mt-2 font-voice text-ui text-pretty text-accent italic">
              {world.story.title}
            </p>
          ) : null}
          <p className="mt-3 text-ui-sm text-pretty text-vellum-2">
            {world.story.act !== null && world.story.act > world.story.acts
              ? t("freeHint")
              : t("standingHint")}
          </p>
          <p className="mt-5 text-caption text-vellum-3">{t("charterTone")}</p>
          <p className="mt-1 text-ui-sm text-pretty text-vellum-2">{world.charter.tone}</p>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title={t("lastRoll")}>
          {roll ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <Die className="h-10 w-10" />
              <p className="font-voice text-display-compact tabular-nums text-vellum">
                {roll.die + roll.modifier}
              </p>
              <p className="text-caption tabular-nums text-vellum-3">
                {roll.modifier !== 0 && roll.attribute
                  ? tGame("dieDetail", {
                      die: roll.die,
                      sign: roll.modifier > 0 ? "+" : "−",
                      value: Math.abs(roll.modifier),
                      attribute: tGame(`attribute.${roll.attribute}` as never),
                    })
                  : tGame("dieRolled")}
              </p>
              <Verdict outcome={roll.outcome} />
            </div>
          ) : (
            <p className="text-ui-sm text-pretty text-vellum-3">{tGame("noRoll")}</p>
          )}
        </Panel>
      </div>

      {/*
        La même essence, ailleurs. Ce qui traverse est le nom, le caractère et
        le socle ; le métier, les talents et les objets appartiennent au monde
        qu'on quitte, et ne se retrouvent donc pas ici.
      */}
      <Panel title={t("elsewhere")} aside={t("elsewhereAside")}>
        <p className="max-w-measure text-caption text-pretty text-vellum-3">
          {t(`arrivalHint.${character.arrival}` as never)}
        </p>

        {character.elsewhere.length === 0 ? (
          <p className="mt-4 max-w-measure text-ui-sm text-pretty text-vellum-3">
            {t("elsewhereEmpty")}
          </p>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {character.elsewhere.map((incarnation) => (
              <li
                key={incarnation.universeId}
                data-world={incarnation.world ?? undefined}
                style={
                  incarnation.accentHue === null
                    ? undefined
                    : ({ "--world-hue": incarnation.accentHue } as CSSProperties)
                }
                className="rounded-card border border-line p-4"
              >
                <span aria-hidden="true" className="block h-1.5 w-8 rounded-xs bg-accent" />
                <p className="mt-2 font-voice text-subtitle text-pretty text-vellum">
                  {incarnation.world ?? tStories("untitled")}
                </p>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-caption text-vellum-3">
                  <Tag tone={incarnation.arrival === "natif" ? "muted" : "arcane"}>
                    {t(`arrivals.${incarnation.arrival}` as never)}
                  </Tag>
                  {incarnation.current
                    ? tStories("open")
                    : tStories(`step.${incarnation.step}` as never)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/*
        Ce qu'on rapporte d'un monde. Pas une épée : ce qu'on vit ailleurs
        change qui est le personnage, pas ce qu'il possède, et c'est ce qui
        garde chaque monde équilibré.
      */}
      <Panel title={t("marks")} aside={t("marksAside")}>
        {character.marks.length === 0 ? (
          <p className="max-w-measure text-ui-sm text-pretty text-vellum-3">
            {t("marksEmpty")}
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {character.marks.map((mark) => (
              <li
                key={`${mark.kind}-${mark.text}`}
                className="rounded-card border border-line p-4"
              >
                <p className="text-caption text-vellum-3">
                  {t(`markKinds.${mark.kind}` as never)}
                  {" · "}
                  {mark.world}
                </p>
                <p className="mt-2 font-voice text-ui text-pretty text-vellum">
                  {mark.text}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* La couleur, là où les attributs sont le calcul : le moteur ne les
            lit pas, le meneur si. */}
        <Panel title={t("talents")} aside={t("talentsAside")}>
          {character.talents.length === 0 ? (
            <p className="text-ui-sm text-pretty text-vellum-3">{t("talentsEmpty")}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {character.talents.map((talent) => (
                <li key={talent}>
                  <Tag tone="accent">{talent}</Tag>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Des noms, et rien d'autre : un objet qui donnerait un bonus serait
            une règle, et l'effet appartient au moteur, jamais au texte. */}
        <Panel
          title={t("inventory")}
          aside={tGame("carryCount", {
            count: character.inventory.length,
            max: INVENTORY_MAX,
          })}
          className="lg:col-span-2"
        >
          {character.inventory.length === 0 ? (
            <p className="text-ui-sm text-pretty text-vellum-3">{t("inventoryEmpty")}</p>
          ) : (
            <ul className="grid gap-x-8 sm:grid-cols-2">
              {character.inventory.map((item) => (
                <li
                  key={item}
                  className="border-b border-line py-2.5 text-ui-sm text-pretty text-vellum last:border-0"
                >
                  {item}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 max-w-measure text-caption text-pretty text-vellum-3">
            {t("inventoryHint")}
          </p>
        </Panel>
      </div>
    </div>
  );
}
