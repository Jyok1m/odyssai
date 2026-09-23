"use client";

import type {
  ChronicleVisit,
  DepartureOutcome,
  Stories,
  Story,
  Traveller,
} from "@odyssai/schemas";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { useAuthLinks } from "@/components/auth/auth-links";
import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { DangerAction } from "@/components/ui/danger-action";
import { useRouter } from "@/i18n/navigation";
import {
  StoriesError,
  decideChronicle,
  deleteStory,
  fetchChronicle,
  fetchStories,
  fetchTravellers,
  selectStory,
  setStoryOpenness,
  startStory,
} from "@/lib/stories";

import { Tag } from "@/components/ui/panel";

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
          <h2 className="font-ui text-caption font-medium tracking-widest text-vellum-2 uppercase">
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
  /*
    L'ouverture se tient ici et non au serveur seul : la carte doit répondre
    au clic sans attendre une relecture de toute la liste.
  */
  const [open, setOpen] = useState(story.open);
  const [opening, setOpening] = useState(false);

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
          <span className="flex flex-wrap items-center gap-2">
            {/* Une visite emprunte son monde : elle n'a ni inspiration, ni
                personnage à écrire, et on ne l'ouvre ni ne la ferme. */}
            {story.visiting ? <Tag tone="arcane">{t("visiting")}</Tag> : null}
            {story.current ? (
              <span className="rounded-full border border-accent px-2 py-0.5 text-caption text-accent">
                {t("open")}
              </span>
            ) : null}
          </span>
        </div>
        <p className="mt-1 flex flex-wrap gap-x-3 text-caption text-vellum-3">
          <span>{t(`step.${story.step}`)}</span>
          <span>
            {format.dateTime(new Date(story.createdAt), { dateStyle: "medium" })}
          </span>
        </p>
      </div>

      {/*
        Ouvert ou fermé aux visiteurs. Fermé par défaut : un monde appartient à
        son créateur tant qu'il n'a pas dit le contraire. Personne ne peut
        encore franchir une faille vers le monde d'un autre, et l'écran le dit
        plutôt que de laisser croire à une porte déjà ouverte.
      */}
      {story.step === "ready" && !story.visiting ? (
        <div className="rounded-card border border-line p-3.5">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={open}
              disabled={busy || opening}
              onChange={async (event) => {
                const next = event.target.checked;
                setOpen(next);
                setOpening(true);
                try {
                  await setStoryOpenness(story.id, next);
                } catch {
                  // Le serveur a refusé : la case reprend ce qu'il dit.
                  setOpen(!next);
                  setError(t("error"));
                } finally {
                  setOpening(false);
                }
              }}
              className="mt-0.5 size-4 flex-none accent-accent"
            />
            <span>
              <span className="block text-ui-sm text-vellum">
                {open ? t("openness.open") : t("openness.closed")}
              </span>
              <span className="mt-0.5 block text-caption text-pretty text-vellum-3">
                {open ? t("openness.openHint") : t("openness.closedHint")}
              </span>
            </span>
          </label>
        </div>
      ) : null}

      {/* Ce que les visites ont laissé, et que personne d'autre que l'hôte ne
          peut trancher. */}
      {story.chronicle > 0 ? <Chronicle story={story} /> : null}

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

/*
  La chronique des voyageurs, sur la carte du monde visité.

  Une visite écrit toujours chez elle. Ce qu'elle laisse ne devient vrai ici
  que lorsque celui à qui ce monde appartient le décide : accepter le recopie
  dans son monde, refuser clôt la question. Dans les deux cas le récit du
  visiteur lui reste, on ne lui retire pas ce qu'il a vécu.
*/
function Chronicle({ story }: { story: Story }) {
  const t = useTranslations("Stories");
  const format = useFormatter();

  const [open, setOpen] = useState(false);
  const [visits, setVisits] = useState<ChronicleVisit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || visits) return;

    const controller = new AbortController();
    fetchChronicle(story.id, controller.signal)
      .then((read) => setVisits(read.visits))
      .catch(() => {
        if (controller.signal.aborted) return;
        setError(t("error"));
      });

    return () => controller.abort();
  }, [open, visits, story.id, t]);

  const decide = async (id: string, kind: "fact" | "entity", accept: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const read = await decideChronicle(story.id, [{ id, kind, accept }]);
      setVisits(read.visits);
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  };

  const left = visits
    ? visits.reduce((count, visit) => count + visit.entries.length, 0)
    : story.chronicle;

  return (
    <div className="rounded-card border border-arcane/40 bg-arcane/8 p-3.5">
      <button
        type="button"
        onClick={() => setOpen((shown) => !shown)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-ui-sm font-medium text-vellum">
          {t("chronicle.title")}
        </span>
        <Tag tone="arcane">{t("chronicle.count", { count: left })}</Tag>
      </button>

      {open ? (
        <div className="mt-3 space-y-4">
          <p className="text-caption text-pretty text-vellum-3">
            {t("chronicle.lead")}
          </p>

          {visits === null ? (
            <p className="text-caption text-vellum-3">{t("loading")}</p>
          ) : visits.length === 0 ? (
            <p className="text-caption text-vellum-3">{t("chronicle.empty")}</p>
          ) : (
            visits.map((visit) => (
              <section key={visit.visitId}>
                <p className="text-caption text-vellum-2">
                  {t("chronicle.visit", {
                    visitor: visit.visitor ?? t("untitled"),
                    character: visit.character ?? t("untitled"),
                    turns: visit.turns,
                  })}
                  {" · "}
                  {format.dateTime(new Date(visit.at), { dateStyle: "medium" })}
                </p>

                <ul className="mt-2 space-y-2">
                  {visit.entries.map((entry) => (
                    <li
                      key={entry.id}
                      className="rounded-control border border-line bg-ink p-3"
                    >
                      <p className="text-caption text-vellum-3">
                        {entry.subject}
                        {entry.entity ? ` · ${t(`chronicle.kind.${entry.entity}`)}` : ""}
                      </p>
                      <p className="mt-1 text-ui-sm text-pretty text-vellum">
                        {entry.statement}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          onClick={() => void decide(entry.id, entry.kind, true)}
                        >
                          {t("chronicle.accept")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void decide(entry.id, entry.kind, false)}
                        >
                          {t("chronicle.decline")}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}

          <p aria-live="polite" className="min-h-4 text-caption text-ember">
            {error}
          </p>
        </div>
      ) : null}
    </div>
  );
}
