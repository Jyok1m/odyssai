"use client";

import type { WorldView } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useEffect, useState, type CSSProperties } from "react";

import { WorldError, fetchWorld } from "@/lib/world";

/**
 * Coquille de jeu. Elle montre le monde généré et le personnage, et ouvre la
 * conversation. Le tour de jeu n'existe pas encore : la saisie est là, inerte,
 * et le dit plutôt que de faire croire à une partie.
 */
export function WorldShell() {
  const t = useTranslations("Play");

  const [world, setWorld] = useState<WorldView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchWorld(controller.signal)
      .then(setWorld)
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof WorldError && caught.code === "not_ready"
            ? t("generation.title")
            : t("world.error"),
        );
      });

    return () => controller.abort();
  }, [t]);

  if (error) return <p className="text-ui-sm text-ember">{error}</p>;
  if (!world) return <p className="text-ui-sm text-vellum-3">{t("world.loading")}</p>;

  return (
    // Le kit dérive l'accent de `--world-hue` sous `[data-world]`, avec sa
    // transition : poser la teinte suffit, et écrire `--accent` à la main
    // contournerait la règle au lieu de la suivre.
    <div
      data-world={world.name}
      style={{ "--world-hue": world.accentHue } as CSSProperties}
      className="space-y-12"
    >
      <header>
        <p className="text-caption text-vellum-3">{t("world.openingTitle")}</p>
        <h1 className="mt-2 font-voice text-display-compact text-balance text-accent">
          {world.name}
        </h1>
        <p className="mt-5 max-w-measure font-voice text-narration text-pretty text-vellum">
          {world.charter.premise}
        </p>
      </header>

      <section className="rounded-card border border-line bg-abyss p-5 sm:p-6">
        <h2 className="font-voice text-subtitle text-vellum">
          {t("world.charterTitle")}
        </h2>

        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-caption text-vellum-3">{t("world.allowed")}</p>
            <ul className="mt-2 space-y-1.5">
              {world.charter.allowed.map((line) => (
                <li key={line} className="text-ui-sm text-vellum-2">
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-caption text-vellum-3">{t("world.forbidden")}</p>
            <ul className="mt-2 space-y-1.5">
              {world.charter.forbidden.map((line) => (
                <li key={line} className="text-ui-sm text-vellum-2">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-6 max-w-measure text-ui-sm text-pretty text-vellum-2">
          {world.lore.geography}
        </p>
      </section>

      <section>
        <h2 className="font-voice text-subtitle text-vellum">
          {t("world.factions")}
        </h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2">
          {world.factions.map((faction) => (
            <li
              key={faction.name}
              className="rounded-card border border-line p-4"
            >
              <p className="font-voice text-subtitle text-accent">{faction.name}</p>
              <p className="mt-2 text-ui-sm text-pretty text-vellum-2">
                {faction.creed}
              </p>
              <p className="mt-2 text-caption text-vellum-3">{faction.symbol}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-voice text-subtitle text-vellum">
          {t("world.people")}
        </h2>
        {/* Aucun secret ici : le schéma de vue ne les porte pas, ils se
            découvriront en jeu. */}
        <ul className="mt-5 space-y-4">
          {world.npcs.map((npc) => (
            <li key={npc.name} className="border-l-2 border-line pl-4">
              <p className="text-ui-sm text-vellum">
                {npc.name}
                <span className="text-vellum-3">
                  {" · "}
                  {npc.role}
                  {" · "}
                  {npc.faction ?? t("world.independent")}
                </span>
              </p>
              <p className="mt-1 text-ui-sm text-pretty text-vellum-2">
                {npc.drive}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-card border border-line bg-abyss p-5 sm:p-6">
        <h2 className="font-voice text-subtitle text-vellum">{t("world.you")}</h2>
        <p className="mt-3 text-ui-sm text-vellum">
          {world.character.name}
          <span className="text-vellum-3">
            {" · "}
            {world.character.gender}
            {" · "}
            {world.character.age}
          </span>
        </p>
        <p className="mt-2 max-w-measure text-ui-sm text-pretty text-vellum-2">
          {world.character.personality.summary}
        </p>

        <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
          {Object.entries(world.character.attributes).map(([key, value]) => (
            <div key={key} className="flex items-baseline gap-2">
              <dt className="text-caption text-vellum-3">{key}</dt>
              <dd className="text-ui-sm text-accent">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Le tour de jeu n'existe pas : la saisie est inerte et le dit. Faire
          croire l'inverse serait pire qu'une absence. */}
      <section className="rounded-card border border-line bg-abyss p-5 sm:p-6">
        <h2 className="font-voice text-subtitle text-vellum">
          {t("world.soonTitle")}
        </h2>
        <p className="mt-3 max-w-measure text-ui-sm text-pretty text-vellum-2">
          {t("world.soonLead")}
        </p>

        <div className="mt-5 flex items-center gap-2 rounded-card border border-line bg-ink py-2 pr-2 pl-3.5 opacity-60">
          <label htmlFor="turn" className="sr-only">
            {t("world.placeholder")}
          </label>
          <input
            id="turn"
            disabled
            placeholder={t("world.placeholder")}
            className="h-8 w-full border-0 bg-transparent font-ui text-ui-sm text-vellum placeholder:text-vellum-3"
          />
        </div>
      </section>
    </div>
  );
}
