"use client";

import type { Story, WorldView } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useEffect, useState, type CSSProperties } from "react";

import type { GlossaryEntry } from "@/components/marketing/glossary-list";
import type { ProseSection } from "@/components/marketing/prose-page";
import { Definition, Panel, Tag } from "@/components/play/panel";
import { Absent, WorldSkin, useWorld } from "@/components/play/use-world";
import { Link } from "@/i18n/navigation";
import { fetchStories } from "@/lib/stories";

/*
  Le livre du monde.

  Deux étages, et l'ordre compte. Le Lore général d'abord : ce que tous les
  mondes ont en commun, en lecture seule pour les univers. Le monde courant
  ensuite : sa charte, son histoire, ses forces, et ce que la partie y a écrit.

  Le texte du Lore général vient des mêmes messages que la page publique, et
  non d'une copie : deux versions du même texte finiraient par diverger, et la
  fausse serait celle que personne ne relit.
*/
export function WorldBook() {
  const t = useTranslations("WorldBook");
  const state = useWorld();

  if (state.status === "loading") {
    return <p className="text-ui-sm text-vellum-3">{t("loading")}</p>;
  }
  if (state.status === "error") {
    return <p className="text-ui-sm text-ember">{t("error")}</p>;
  }

  /*
    Sans monde généré, le Lore général reste lisible : il ne dépend d'aucune
    partie, et c'est justement ce qui le définit.
  */
  if (state.status === "not_ready") {
    return (
      <div className="space-y-5">
        <Header />
        <General />
        <Stories />
        <Absent message={t("notReady")} />
      </div>
    );
  }

  return (
    <WorldSkin world={state.world} className="space-y-5">
      <Header world={state.world} />
      <General />
      <Stories />
      <World world={state.world} />
      <Glossary />
    </WorldSkin>
  );
}

function Header({ world }: { world?: WorldView }) {
  const t = useTranslations("WorldBook");

  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div>
        <p className="text-caption tracking-[0.12em] text-vellum-3 uppercase">
          {t("title")}
        </p>
        <h1 className="mt-2 font-voice text-display-compact text-balance text-vellum">
          {world ? world.name : t("general")}
        </h1>
      </div>
      <p className="text-ui-sm text-vellum-3">{t("readOnly")}</p>
    </header>
  );
}

// Le Lore général, tel que la page publique le dit. Même source, deux écrans.
function General() {
  const t = useTranslations("WorldBook");
  const tLore = useTranslations("Lore");

  const intro = tLore.raw("intro") as string[];
  const sections = tLore.raw("sections") as ProseSection[];

  return (
    <>
      <Panel title={t("general")}>
        <p className="max-w-headline font-voice text-title text-balance text-vellum">
          {tLore("lead")}
        </p>
        {intro.map((paragraph) => (
          <p
            key={paragraph}
            className="mt-5 max-w-measure text-ui text-pretty text-vellum-2"
          >
            {paragraph}
          </p>
        ))}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        {sections.map((section) => (
          <Panel key={section.title} title={section.title}>
            {section.body.map((paragraph) => (
              <p
                key={paragraph}
                className="mt-3 max-w-measure text-ui-sm text-pretty text-vellum-2 first:mt-0"
              >
                {paragraph}
              </p>
            ))}
          </Panel>
        ))}
      </div>
    </>
  );
}

/*
  Les mondes du joueur, avec leur teinte. Celle qui est ouverte est encadrée :
  c'est elle que le reste de cette page raconte.
*/
function Stories() {
  const t = useTranslations("WorldBook");
  const tStories = useTranslations("Stories");
  const [stories, setStories] = useState<Story[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    fetchStories(controller.signal)
      .then((listed) => setStories(listed.stories))
      // Une liste indisponible fait disparaître le bloc, pas la page.
      .catch(() => {});

    return () => controller.abort();
  }, []);

  if (stories.length === 0) return null;

  return (
    <Panel title={t("stories")} aside={t("storiesHint")}>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stories.map((story) => (
          <li key={story.id}>
            <Link
              href="/play/stories"
              data-world={story.name ?? undefined}
              style={
                story.accentHue === null
                  ? undefined
                  : ({ "--world-hue": story.accentHue } as CSSProperties)
              }
              className={[
                "flex h-full flex-col gap-2 rounded-card border p-4 transition-colors hover:border-accent",
                story.current ? "border-accent bg-accent/8" : "border-line",
              ].join(" ")}
            >
              <span aria-hidden="true" className="h-1.5 w-8 rounded-xs bg-accent" />
              <span className="font-voice text-subtitle text-pretty text-vellum">
                {story.name ?? tStories("untitled")}
              </span>
              <span className="mt-auto text-caption text-vellum-3">
                {story.current
                  ? t("current")
                  : tStories(`step.${story.step}` as never)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function World({ world }: { world: WorldView }) {
  const t = useTranslations("WorldBook");
  const tGame = useTranslations("Game");

  return (
    <>
      {/* Ce qui existe ou non ici. Le narrateur la respecte en toutes
          circonstances : c'est elle qui empêche un monde sans magie d'en voir
          apparaître au troisième tour. */}
      <Panel title={t("charter")}>
        <p className="max-w-measure font-voice text-narration text-pretty text-vellum">
          {world.charter.premise}
        </p>
        <p className="mt-4 max-w-measure text-ui-sm text-pretty text-vellum-2">
          {world.charter.tone}
        </p>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-caption text-vellum-3">{t("allowed")}</p>
            <ul className="mt-2 space-y-1.5">
              {world.charter.allowed.map((line) => (
                <li key={line} className="text-ui-sm text-pretty text-vellum-2">
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-caption text-vellum-3">{t("forbidden")}</p>
            <ul className="mt-2 space-y-1.5">
              {world.charter.forbidden.map((line) => (
                <li key={line} className="text-ui-sm text-pretty text-vellum-2">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={t("lore")}>
          <dl className="divide-y divide-line">
            <Definition term={t("era")}>{world.lore.era}</Definition>
            <Definition term={t("geography")}>{world.lore.geography}</Definition>
            <Definition term={t("history")}>{world.lore.history}</Definition>
            <Definition term={t("dailyLife")}>{world.lore.dailyLife}</Definition>
          </dl>
        </Panel>

        <Panel title={t("politics")}>
          <p className="max-w-measure text-ui-sm text-pretty text-vellum-2">
            {world.politics.balance}
          </p>
          <p className="mt-5 text-caption text-vellum-3">{t("conflicts")}</p>
          <ul className="mt-2 space-y-2">
            {world.politics.conflicts.map((conflict) => (
              <li
                key={conflict}
                className="border-l-2 border-line pl-3 text-ui-sm text-pretty text-vellum-2"
              >
                {conflict}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-caption text-vellum-3">{t("stakes")}</p>
          <p className="mt-1 max-w-measure text-ui-sm text-pretty text-vellum-2">
            {world.politics.stakes}
          </p>
        </Panel>
      </div>

      <Panel title={t("factions")}>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {world.factions.map((faction) => (
            <li key={faction.name} className="rounded-card border border-line p-4">
              <p className="font-voice text-subtitle text-accent">{faction.name}</p>
              <p className="mt-2 text-ui-sm text-pretty text-vellum-2">{faction.creed}</p>
              <dl className="mt-3 divide-y divide-line text-caption">
                <Definition term={t("strength")}>{faction.strength}</Definition>
                <Definition term={t("territory")}>{faction.territory}</Definition>
                <Definition term={t("symbol")}>{faction.symbol}</Definition>
              </dl>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Aucun secret ici : le schéma de vue ne les porte pas, ils se
            découvriront en jeu. */}
        <Panel title={t("people")}>
          <ul className="space-y-4">
            {world.npcs.map((npc) => (
              <li key={npc.name} className="border-l-2 border-line pl-4">
                <p className="text-ui-sm text-vellum">
                  {npc.name}
                  <span className="text-vellum-3">
                    {" · "}
                    {npc.role}
                    {" · "}
                    {npc.faction ?? t("independent")}
                  </span>
                </p>
                <p className="mt-1 text-ui-sm text-pretty text-vellum-2">{npc.drive}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={t("links")}>
          <ul className="space-y-3">
            {world.affinities.map((affinity) => (
              <li
                key={`${affinity.subject}-${affinity.target}-${affinity.stance}`}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-1"
              >
                <span className="text-ui-sm text-vellum">{affinity.subject}</span>
                <Tag tone={affinity.stance === "allie" ? "accent" : "muted"}>
                  {t(`stance.${affinity.stance}` as never)}
                </Tag>
                <span className="text-ui-sm text-vellum">{affinity.target}</span>
                <span className="w-full text-caption text-pretty text-vellum-3">
                  {affinity.note}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Ce que le joueur a appris, entité par entité. Le caché n'est pas
            dans le type, il sortira par le jeu. */}
        <Panel title={t("codex")} aside={String(world.entities.length)}>
          {world.entities.length === 0 ? (
            <p className="text-ui-sm text-pretty text-vellum-3">{t("codexEmpty")}</p>
          ) : (
            <ul className="space-y-4">
              {world.entities.map((entity) => (
                <li
                  key={`${entity.kind}-${entity.name}`}
                  className="border-l-2 border-line pl-4"
                >
                  <p className="text-ui-sm text-vellum">
                    {entity.name}
                    <span className="text-vellum-3">
                      {" · "}
                      {tGame(`kind.${entity.kind}` as never)}
                    </span>
                  </p>
                  <p className="mt-1 text-ui-sm text-pretty text-vellum-2">
                    {entity.known}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Ce que le meneur a inventé en répondant, et qui est vrai depuis.
            Une réponse donnée une fois reste vraie. */}
        <Panel title={t("canon")} aside={String(world.canon.length)}>
          {world.canon.length === 0 ? (
            <p className="text-ui-sm text-pretty text-vellum-3">{t("canonEmpty")}</p>
          ) : (
            <dl className="divide-y divide-line">
              {world.canon.map((fact) => (
                <Definition key={`${fact.subject}-${fact.statement}`} term={fact.subject}>
                  {fact.statement}
                </Definition>
              ))}
            </dl>
          )}
        </Panel>
      </div>
    </>
  );
}

// Les mêmes définitions que la page publique, à portée de la partie.
function Glossary() {
  const t = useTranslations("WorldBook");
  const tGlossary = useTranslations("Glossary");
  const entries = tGlossary.raw("entries") as GlossaryEntry[];

  return (
    <Panel title={t("glossary")}>
      <dl className="divide-y divide-line">
        {entries.map((entry) => (
          <Definition key={entry.term} term={entry.term}>
            {entry.meaning}
          </Definition>
        ))}
      </dl>
    </Panel>
  );
}
