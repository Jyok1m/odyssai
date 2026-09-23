"use client";

import { STORIES_MAX, type Story } from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useEffect, useState, type CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Link } from "@/i18n/navigation";
import { fetchStories } from "@/lib/stories";

/*
  Où en est le joueur de ses histoires, sur l'écran du compte.

  Le compte dit ce qu'on a : un pseudo, une réserve, des histoires. Il ne dit
  pas ce qu'on y fait : jouer, en commencer une, en supprimer une sont
  l'affaire de l'onglet, et le bouton y mène plutôt que de le refaire ici.
*/
export function StoriesStanding() {
  const t = useTranslations("Account");
  const [stories, setStories] = useState<Story[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchStories(controller.signal)
      .then((listed) => setStories(listed.stories))
      // Une liste indisponible n'empêche pas de lire son compte.
      .catch(() => {});

    return () => controller.abort();
  }, []);

  if (stories === null) return null;

  const current = stories.find((story) => story.current) ?? null;

  return (
    <Panel title={t("storiesTitle")}>
      <p className="flex items-baseline gap-2">
        <span className="font-voice text-display-compact tabular-nums text-vellum">
          {stories.length}
        </span>
        <span className="text-ui-sm text-vellum-2">
          {t("storiesCount", { max: STORIES_MAX })}
        </span>
      </p>

      {/* Un segment par emplacement, à sa teinte : une jauge continue dirait
          une progression, alors que ce sont des places. */}
      <ul aria-hidden="true" className="mt-4 flex gap-1.5">
        {Array.from({ length: STORIES_MAX }, (_, index) => {
          const story = stories[index];

          return (
            <li
              key={index}
              data-world={story?.name ?? undefined}
              style={
                story?.accentHue == null
                  ? undefined
                  : ({ "--world-hue": story.accentHue } as CSSProperties)
              }
              className={[
                "h-1.5 flex-1 rounded-xs",
                story ? (story.accentHue === null ? "bg-vellum-3" : "bg-accent") : "bg-mist",
              ].join(" ")}
            />
          );
        })}
      </ul>

      {current ? (
        <>
          <p className="mt-5 text-caption text-vellum-3">{t("storiesOpen")}</p>
          <p
            data-world={current.name ?? undefined}
            style={
              current.accentHue === null
                ? undefined
                : ({ "--world-hue": current.accentHue } as CSSProperties)
            }
            className="mt-1 font-voice text-subtitle text-pretty text-accent"
          >
            {current.name ?? t("storiesUntitled")}
          </p>
        </>
      ) : (
        <p className="mt-5 max-w-measure text-ui-sm text-pretty text-vellum-3">
          {t("storiesNone")}
        </p>
      )}

      <Button as={Link} href="/play/stories" variant="secondary" className="mt-5">
        {t("storiesLink")}
      </Button>
    </Panel>
  );
}
