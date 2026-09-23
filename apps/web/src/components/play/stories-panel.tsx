"use client";

import type { DepartureOutcome, Stories, Story, Traveller } from "@odyssai/schemas";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { useAuthLinks } from "@/components/auth/auth-links";
import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { DangerAction } from "@/components/ui/danger-action";
import { useRouter } from "@/i18n/navigation";
import {
  StoriesError,
  deleteStory,
  fetchStories,
  fetchTravellers,
  selectStory,
  startStory,
} from "@/lib/stories";

import { Tag } from "./panel";

/*
  Les histoires du joueur : en commencer une, en ouvrir une, en supprimer une.
  Jouer ramène à la table : c'est le parcours qui suit l'histoire ouverte, et
  cet écran ne fait que dire laquelle.
*/
export function StoriesPanel() {
  const t = useTranslations("Stories");
  const tNav = useTranslations("Nav");
  const session = useSession();
  const { signIn } = useAuthLinks();
  const router = useRouter();

  const [data, setData] = useState<Stories | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<DepartureOutcome | null>(null);
  /*
    Les personnages déjà écrits. Une liste indisponible ne casse rien : le
    bouton ordinaire reste, et c'est lui le chemin de tous les jours.
  */
  const [travellers, setTravellers] = useState<Traveller[]>([]);
  // Ouvre le choix du personnage à amener, plutôt que d'empiler les boutons.
  const [carrying, setCarrying] = useState(false);

  const load = useCallback(
    (signal?: AbortSignal) =>
      fetchStories(signal)
        .then(setData)
        .catch(() => {
          if (signal?.aborted) return;
          setError(t("error"));
        }),
    [t],
  );

  useEffect(() => {
    if (session.status !== "authenticated") return;

    const controller = new AbortController();
    void load(controller.signal);
    // Silencieux : sans personnage à amener, le bouton n'apparaît pas, et
    // c'est exactement ce qu'une liste indisponible doit donner.
    fetchTravellers(controller.signal)
      .then((listed) => setTravellers(listed.travellers))
      .catch(() => {});

    return () => controller.abort();
  }, [session.status, load]);

  if (session.status === "loading") {
    return <p className="text-ui-sm text-vellum-3">{t("loading")}</p>;
  }

  if (session.status === "anonymous") {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-ui-sm text-vellum-2">{t("signedOut")}</p>
        <Button as="a" href={signIn}>
          {tNav("login")}
        </Button>
      </div>
    );
  }

  if (!data) {
    return <p className="text-ui-sm text-ember">{error ?? t("loading")}</p>;
  }

  // Ouvrir puis rejoindre la table : la partie repart de l'état de celle-là.
  const play = async (story: Story) => {
    setBusy(true);
    setError(null);
    try {
      if (!story.current) await selectStory(story.id);
      router.push("/play");
    } catch {
      setError(t("error"));
      setBusy(false);
    }
  };

  const create = async (essenceId?: string) => {
    setBusy(true);
    setError(null);
    try {
      await startStory(essenceId);
      router.push("/play");
    } catch (caught: unknown) {
      setError(
        t(
          caught instanceof StoriesError && caught.code === "stories_full"
            ? "full"
            : "error",
          { max: data.max },
        ),
      );
      setBusy(false);
    }
  };

  const full = data.stories.length >= data.max;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-4">
        <Button type="button" disabled={busy || full} onClick={() => void create()}>
          {t("new")}
        </Button>

        {/* Amener un personnage qu'on a déjà : son nom, son caractère et son
            socle traversent ; ses talents et ses objets restent au monde
            qu'il quitte. */}
        {travellers.length > 0 ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy || full}
            onClick={() => setCarrying((open) => !open)}
          >
            {t("carry")}
          </Button>
        ) : null}

        <p className="text-ui-sm text-vellum-3">
          {full ? t("full", { max: data.max }) : t("count", { count: data.stories.length, max: data.max })}
        </p>
      </div>

      {carrying ? (
        <section className="rounded-card border border-line bg-abyss p-5 sm:p-6">
          <h2 className="font-ui text-caption font-medium tracking-[0.12em] text-vellum-2 uppercase">
            {t("carryTitle")}
          </h2>
          <p className="mt-2 max-w-measure text-ui-sm text-pretty text-vellum-3">
            {t("carryHint")}
          </p>

          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {travellers.map((traveller) => (
              <li key={traveller.id}>
                <button
                  type="button"
                  disabled={busy || full}
                  onClick={() => void create(traveller.id)}
                  className="w-full rounded-card border border-line p-4 text-left transition-colors hover:border-accent hover:bg-mist disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="font-voice text-subtitle text-vellum">
                      {traveller.name}
                    </span>
                    <span className="text-caption text-vellum-3">
                      {t("worlds", { count: traveller.incarnations.length })}
                    </span>
                  </span>
                  {traveller.traits.length > 0 ? (
                    <span className="mt-2 flex flex-wrap gap-2">
                      {traveller.traits.map((trait) => (
                        <Tag key={trait}>{trait}</Tag>
                      ))}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.stories.length === 0 ? (
        <p className="text-ui-sm text-vellum-3">{t("empty")}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {data.stories.map((story) => (
            <StoryCard
              key={story.id}
              story={story}
              busy={busy}
              onPlay={() => void play(story)}
              onDeleted={(result) => {
                setOutcome(result);
                void load();
              }}
            />
          ))}
        </ul>
      )}

      <p aria-live="polite" className="min-h-5 text-ui-sm text-vellum-2">
        {error ? <span className="text-ember">{error}</span> : outcomeText(outcome, t)}
      </p>
    </div>
  );
}

function outcomeText(
  outcome: DepartureOutcome | null,
  t: ReturnType<typeof useTranslations<"Stories">>,
): string | null {
  if (!outcome) return null;
  if (outcome.world === "kept") return t("outcome.kept");
  if (outcome.character === "remembered") return t("outcome.remembered");
  return t("outcome.gone");
}

interface CardProps {
  story: Story;
  busy: boolean;
  onPlay: () => void;
  onDeleted: (outcome: DepartureOutcome) => void;
}

function StoryCard({ story, busy, onPlay, onDeleted }: CardProps) {
  const t = useTranslations("Stories");
  const tDanger = useTranslations("Danger");
  const format = useFormatter();
  const [error, setError] = useState<string | null>(null);

  // Un monde généré porte sa teinte, comme à la table : le kit dérive
  // l'accent de `--world-hue` sous `[data-world]`.
  const themed = story.accentHue !== null;

  return (
    <li
      data-world={themed ? (story.name ?? "") : undefined}
      style={themed ? ({ "--world-hue": story.accentHue } as CSSProperties) : undefined}
      className="flex flex-col gap-5 rounded-card border border-line bg-abyss p-5"
    >
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="font-voice text-subtitle text-accent">
            {story.name ?? t("untitled")}
          </h2>
          {story.current ? (
            <span className="rounded-full border border-accent px-2 py-0.5 text-caption text-accent">
              {t("open")}
            </span>
          ) : null}
        </div>
        <p className="mt-1 flex flex-wrap gap-x-3 text-caption text-vellum-3">
          <span>{t(`step.${story.step}`)}</span>
          <span>
            {format.dateTime(new Date(story.createdAt), { dateStyle: "medium" })}
          </span>
        </p>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-3">
        <Button type="button" disabled={busy} onClick={onPlay}>
          {story.current ? t("continue") : t("play")}
        </Button>
        <DangerAction
          label={tDanger("story.label")}
          title={tDanger("story.title")}
          lead={tDanger("story.lead")}
          confirmLabel={tDanger("story.confirm")}
          busyLabel={tDanger("story.busy")}
          error={error}
          consequences={
            <ul className="space-y-1.5">
              <li>{tDanger("what.world")}</li>
              <li>{tDanger("what.character")}</li>
              <li className="text-vellum-3">{tDanger("what.visited")}</li>
            </ul>
          }
          onConfirm={async () => {
            setError(null);
            try {
              onDeleted(await deleteStory(story.id));
            } catch (caught: unknown) {
              setError(
                t(
                  caught instanceof StoriesError && caught.code === "locked"
                    ? "locked"
                    : "error",
                ),
              );
            }
          }}
        />
      </div>
    </li>
  );
}
