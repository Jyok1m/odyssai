"use client";

import {
  INVENTORY_MAX,
  entityKey,
  type Attribute,
  type AttributeStanding,
  type Health,
  type PublicEntity,
  type RollRecord,
  type ScenePresence,
  type WorldView,
} from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { CreditsBadge } from "@/components/play/credits-badge";
import { AttributeCells } from "@/components/play/attributes";
import { Die, GameChat, Verdict, type TableEvents } from "@/components/play/game-chat";
import { HealthBar } from "@/components/play/health";
import { Panel, Tag } from "@/components/ui/panel";
import { Link } from "@/i18n/navigation";

import { RestartAction } from "./restart-action";
import { WorldSkin, useWorld } from "./use-world";

/*
  L'écran de jeu, une fois le monde prêt. La lecture du monde vit ici : le
  parcours n'a pas à savoir ce qu'est un monde pour savoir qu'il est fini.
*/
export function WorldShell({ onRestart }: { onRestart: () => void }) {
  const t = useTranslations("Play");
  const state = useWorld();

  if (state.status === "loading") {
    return <p className="text-ui-sm text-vellum-3">{t("world.loading")}</p>;
  }
  if (state.status === "not_ready") {
    return <p className="text-ui-sm text-vellum-3">{t("generation.title")}</p>;
  }
  if (state.status === "error") {
    return <p className="text-ui-sm text-ember">{t("world.error")}</p>;
  }

  return (
    <WorldSkin world={state.world}>
      <GameTable world={state.world} onRestart={onRestart} />
    </WorldSkin>
  );
}

/*
  La coquille de jeu.

  Le récit tient la colonne de lecture, et ce qui change d'état se lit à côté :
  la fiche, le dernier jet, ce qu'on porte, ce que le monde vient d'apprendre.
  C'est elle qui tient ces états, parce qu'ils naissent dans le fil et se
  lisent dans les panneaux : les laisser dans le fil les y enfermerait.

  `onRestart` fait relire le parcours : le serveur a ramené le joueur à
  l'inspiration, et l'assistant doit le suivre.
*/
function GameTable({
  world,
  onRestart,
}: {
  world: WorldView;
  onRestart: () => void;
}) {
  const t = useTranslations("Game");

  const [carrying, setCarrying] = useState<string[]>(world.character.inventory);
  // Ce qui vient d'entrer dans le sac, pour le signaler une séance durant.
  const [fresh, setFresh] = useState<string[]>([]);
  const [roll, setRoll] = useState<RollRecord | null>(null);
  const [standing, setStanding] = useState<Record<Attribute, AttributeStanding>>(
    world.character.standing,
  );
  const [health, setHealth] = useState<Health>(world.character.health);
  // Ce que le dernier tour a coûté, montré une fois puis oublié au suivant.
  const [harm, setHarm] = useState(0);
  const [codex, setCodex] = useState<PublicEntity[]>(world.entities);
  const [scene, setScene] = useState<ScenePresence[]>([]);
  // Nul tant qu'aucun tour n'a été joué dans cette séance.
  const [learned, setLearned] = useState<number | null>(null);
  // Incrémenté à chaque tour joué : c'est ce qui fait relire la réserve.
  const [played, setPlayed] = useState(0);

  const report = useMemo<TableEvents>(
    () => ({
      carrying(items, gained) {
        setCarrying(items);
        // Le serveur dit ce qui vient d'entrer ; l'écran ne fait que le garder
        // marqué le temps de la séance.
        if (gained.length > 0) {
          setFresh((marked) => [...new Set([...marked, ...gained])]);
        }
      },
      rolled: setRoll,
      grew(attribute, next) {
        setStanding((current) => ({ ...current, [attribute]: next }));
      },
      staged: setScene,
      hurt(next, taken) {
        setHealth(next);
        setHarm(taken);
      },
      learned(entity) {
        setCodex((current) => [
          ...current.filter((known) => entityKey(known.name) !== entityKey(entity.name)),
          entity,
        ]);
      },
      played(canon) {
        setLearned(canon);
        setPlayed((count) => count + 1);
      },
    }),
    [],
  );

  const tested = roll?.attribute ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <CreditsBadge refreshKey={played} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        {/* La table, d'abord : c'est là qu'on joue, le reste est ce qu'on
            consulte sans quitter la partie des yeux. */}
        <GameChat world={world} report={report} />

        <aside className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
          <Panel
            title={t("character")}
            aside={<PanelLink href="/play/character">{t("sheetLink")}</PanelLink>}
            className="sm:col-span-2 lg:col-span-1"
          >
            <div className="flex items-center gap-4">
              <span
                aria-hidden="true"
                style={{ borderRadius: "var(--radius-portal)" }}
                className="grid h-24 w-20 flex-none place-items-center border border-accent/40 bg-mist pt-4 font-voice text-title text-accent"
              >
                {world.character.name.slice(0, 1)}
              </span>
              <div className="min-w-0">
                <p className="font-voice text-subtitle text-vellum">
                  {world.character.name}
                </p>
                <p className="mt-1 text-caption text-vellum-3">
                  {world.character.gender}
                  {" · "}
                  {t("age", { age: world.character.age })}
                </p>
                {world.character.personality.traits.length > 0 ? (
                  <p className="mt-1 text-caption text-pretty text-vellum-2">
                    {world.character.personality.traits.join(", ")}
                  </p>
                ) : null}
              </div>
            </div>

            {world.character.talents.length > 0 ? (
              <ul className="mt-4 flex flex-wrap gap-2">
                {world.character.talents.map((talent) => (
                  <li key={talent}>
                    <Tag>{talent}</Tag>
                  </li>
                ))}
              </ul>
            ) : null}

            {/* La jauge, sous la fiche : c'est le code qui l'entame et qui
                la rend, le meneur n'en reçoit qu'un mot. */}
            <div className="mt-5">
              <HealthBar health={health} harm={harm} />
            </div>

            <div className="mt-5">
              <AttributeCells standing={standing} tested={tested} />
            </div>
          </Panel>

          <Panel title={t("lastRoll")}>
            {roll ? (
              <div className="flex flex-col items-center gap-2 text-center">
                <Die className="h-10 w-10" />
                <p className="font-voice text-title tabular-nums text-vellum">
                  {roll.die + roll.modifier}
                </p>
                <p className="text-caption tabular-nums text-vellum-3">
                  {roll.modifier !== 0 && roll.attribute
                    ? t("dieDetail", {
                        die: roll.die,
                        sign: roll.modifier > 0 ? "+" : "−",
                        value: Math.abs(roll.modifier),
                        attribute: t(`attribute.${roll.attribute}` as never),
                      })
                    : t("dieRolled")}
                </p>
                <Verdict outcome={roll.outcome} />
              </div>
            ) : (
              <p className="text-ui-sm text-pretty text-vellum-3">{t("noRoll")}</p>
            )}
          </Panel>

          {/* Des noms, jamais un effet : le meneur les raconte, le moteur ne
              les calcule pas. */}
          <Panel
            title={t("carryTitle")}
            aside={t("carryCount", { count: carrying.length, max: INVENTORY_MAX })}
          >
            {carrying.length === 0 ? (
              <p className="text-ui-sm text-pretty text-vellum-3">{t("carryEmpty")}</p>
            ) : (
              <ul>
                {carrying.map((item) => (
                  <li
                    key={item}
                    className="flex items-center justify-between gap-3 border-b border-line py-2.5 text-ui-sm text-vellum last:border-0"
                  >
                    <span className="text-pretty">{item}</span>
                    {fresh.includes(item) ? <Tag tone="brass">{t("newItem")}</Tag> : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title={t("inWorld")}
            aside={<PanelLink href="/play/world">{t("worldLink")}</PanelLink>}
            className="sm:col-span-2 lg:col-span-1"
          >
            <p className="font-voice text-subtitle text-accent">{world.name}</p>

            {/* Qui le meneur vient de nommer. Celui qui est là sans être nommé
                ne s'y voit pas, et il n'y était pas pour le joueur non plus. */}
            <p className="mt-4 text-caption text-vellum-3">{t("scene")}</p>
            <ul className="mt-2 space-y-1.5">
              <li className="flex items-center justify-between gap-3 rounded-card border border-line px-3 py-2 text-ui-sm text-vellum">
                <span className="flex items-center gap-2.5">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
                  {world.character.name}
                </span>
                <span className="text-caption text-vellum-3">{t("youTag")}</span>
              </li>
              {scene.map((present) => (
                <li
                  key={`${present.kind}-${present.name}`}
                  className="flex items-center justify-between gap-3 rounded-card border border-line px-3 py-2 text-ui-sm text-vellum"
                >
                  <span className="flex items-center gap-2.5">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full bg-arcane" />
                    {present.name}
                  </span>
                  <span className="text-caption text-vellum-3">
                    {t(`kind.${present.kind}` as never)}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-5 text-caption text-vellum-3">{t("codex")}</p>
            {codex.length === 0 ? (
              <p className="mt-2 text-ui-sm text-pretty text-vellum-3">
                {t("codexEmpty")}
              </p>
            ) : (
              <ul className="mt-2 space-y-3">
                {/* Les dernières apprises : le codex entier se lit ailleurs. */}
                {codex.slice(-4).reverse().map((entry) => (
                  <li
                    key={`${entry.kind}-${entry.name}`}
                    className="border-l-2 border-line pl-3"
                  >
                    <p className="text-ui-sm text-vellum">
                      {entry.name}
                      <span className="text-vellum-3">
                        {" · "}
                        {t(`kind.${entry.kind}` as never)}
                      </span>
                    </p>
                    <p className="mt-0.5 text-caption text-pretty text-vellum-2">
                      {entry.known}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {/* Ce que le meneur vient d'inventer et qui est désormais vrai.
                Vide est la réponse normale : le canon dit ce qui est vrai, pas
                ce qui se passe. */}
            {learned !== null && learned > 0 ? (
              <p className="mt-5 flex items-center gap-2 text-caption text-brass">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brass" />
                {t("canonThisTurn", { count: learned })}
              </p>
            ) : null}
          </Panel>
        </aside>
      </div>

      {/* En bas, et derrière un mot à taper : recommencer abandonne un monde
          qu'on a mis des minutes à faire naître. */}
      <section className="border-t border-line pt-8">
        <RestartAction onDone={onRestart} />
      </section>
    </div>
  );
}

function PanelLink({ href, children }: { href: "/play/character" | "/play/world"; children: string }) {
  return (
    <Link
      href={href}
      className="font-ui text-caption font-medium text-accent transition-colors hover:text-vellum"
    >
      {children} <span aria-hidden="true">&rarr;</span>
    </Link>
  );
}
