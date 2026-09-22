"use client";

import type { OnboardingStep, Story } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useEffect, useState, type CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import { StoriesError, fetchStories, selectStory, startStory } from "@/lib/stories";

interface Props {
  // L'histoire ouverte et son étape, telles que le parcours les voit : la
  // liste se relit quand elles changent, un monde généré prend son nom.
  current: string | null;
  step: OnboardingStep;
  // Le parcours relit son état : c'est lui qui suit l'histoire ouverte.
  onChange: () => void;
}

/*
  Les histoires du joueur, côte à côte. Rien ne s'affiche tant qu'il n'en a
  aucune : à sa première visite, il est déjà sur une histoire neuve, et lui
  proposer d'en commencer une autre serait une question sans objet.
*/
export function StorySwitcher({ current, step, onChange }: Props) {
  const t = useTranslations("Play");

  const [stories, setStories] = useState<Story[]>([]);
  const [max, setMax] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchStories(controller.signal)
      .then((result) => {
        setStories(result.stories);
        setMax(result.max);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setError(t("stories.error"));
      });

    return () => controller.abort();
  }, [current, step, t]);

  if (stories.length === 0) return null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChange();
    } catch (caught: unknown) {
      setError(
        t(
          caught instanceof StoriesError && caught.code === "stories_full"
            ? "stories.full"
            : "stories.error",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <nav aria-label={t("stories.title")} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-caption text-vellum-3">{t("stories.title")}</span>

        {stories.map((story) => (
          <button
            key={story.id}
            type="button"
            disabled={busy || story.current}
            aria-current={story.current ? "true" : undefined}
            onClick={() => void run(() => selectStory(story.id))}
            // La puce d'un monde généré prend sa teinte, comme l'écran de jeu :
            // le kit dérive l'accent de `--world-hue` sous `[data-world]`.
            data-world={story.accentHue !== null ? story.name ?? "" : undefined}
            style={
              story.accentHue !== null
                ? ({ "--world-hue": story.accentHue } as CSSProperties)
                : undefined
            }
            className={[
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-ui-sm transition-colors",
              story.current
                ? "border-accent text-accent"
                : "border-line text-vellum-2 hover:border-vellum-3 disabled:opacity-60",
            ].join(" ")}
          >
            {story.name ?? t("stories.untitled")}
            {story.step !== "ready" ? (
              <span className="text-caption text-vellum-3">
                {t(`stories.step.${story.step}`)}
              </span>
            ) : null}
          </button>
        ))}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy || stories.length >= max}
          onClick={() => void run(startStory)}
        >
          {t("stories.new")}
        </Button>
      </div>

      <p aria-live="polite" className="min-h-5 text-ui-sm text-ember">
        {error ?? (stories.length >= max ? t("stories.full") : null)}
      </p>
    </nav>
  );
}
