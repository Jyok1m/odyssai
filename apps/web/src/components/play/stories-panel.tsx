"use client";

import type {
  ChronicleVisit,
  DepartureOutcome,
  Stories,
  Story,
  Traveller,
  WorldView,
} from "@odyssai/schemas";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { useAuthLinks } from "@/components/auth/auth-links";
import { useSession } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { DangerAction } from "@/components/ui/danger-action";
import { FIELD } from "@/components/ui/field";
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
import { createParty, joinParty, PartyError } from "@/lib/party";

import { Tag } from "@/components/ui/panel";
import { fetchWorld } from "@/lib/world";

import { Constellation } from "./constellation";

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
  // Ouvre le choix du nombre de joueurs, puis la saisie du code.
  const [gathering, setGathering] = useState(false);
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState("");

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

  /*
    Ouvrir une table : le joueur choisit combien ils seront, l'histoire naît
    vide et chacun la remplit de sa part. Un bouton à part : le solo n'est pas
    un cas particulier de la table, c'est l'autre chemin.
  */
  const openTable = async (size: number) => {
    setBusy(true);
    setError(null);
    try {
      await createParty(size);
      router.push("/play");
    } catch (caught: unknown) {
      setError(partyErrorKey(caught, t, data.max));
      setBusy(false);
    }
  };

  const joinTable = async () => {
    setBusy(true);
    setError(null);
    try {
      await joinParty(code);
      setJoining(false);
      setCode("");
      router.push("/play");
    } catch (caught: unknown) {
      setError(partyErrorKey(caught, t, data.max));
      setBusy(false);
    }
  };

  const full = data.stories.length >= data.max;
  const free = Math.max(0, data.max - data.stories.length);

  // L'ouverte d'abord, le reste dans l'ordre ou elles sont nees.
  const sorted = [...data.stories].sort(
    (left, right) => Number(right.current) - Number(left.current),
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-4">
        <Button type="button" disabled={busy || full} onClick={() => void create()}>
          {t("new")}
        </Button>

        {/* Jouer à plusieurs : ouvrir une table, ou rejoindre celle d'un
            ami par son code. Deux boutons plutôt qu'un menu, c'est deux
            chemins et non deux réglages. */}
        <Button
          type="button"
          variant="secondary"
          disabled={busy || full}
          onClick={() => setGathering((open) => !open)}
        >
          {t("party.open")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => setJoining((open) => !open)}
        >
          {t("party.join")}
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

      {/* Combien de joueurs : le monde se génère une fois pour la table, et
          la taille choisit combien de sièges l'attendent. */}
      {gathering ? (
        <section className="rounded-card border border-line bg-abyss p-5 sm:p-6">
          <h2 className="font-ui text-caption font-medium tracking-widest text-vellum-2 uppercase">
            {t("party.openTitle")}
          </h2>
          <p className="mt-2 max-w-measure text-ui-sm text-pretty text-vellum-3">
            {t("party.openLead")}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {[2, 3, 4].map((size) => (
              <Button
                key={size}
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void openTable(size)}
              >
                {t("party.size", { size })}
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      {/* Le code se partage hors bande, à voix haute ou par message : le
          champ accepte ce qu'on y colle, tirets et casses comprises. */}
      {joining ? (
        <section className="rounded-card border border-line bg-abyss p-5 sm:p-6">
          <h2 className="font-ui text-caption font-medium tracking-widest text-vellum-2 uppercase">
            {t("party.joinTitle")}
          </h2>
          <p className="mt-2 max-w-measure text-ui-sm text-pretty text-vellum-3">
            {t("party.joinLead")}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder={t("party.codePlaceholder")}
              maxLength={20}
              aria-label={t("party.joinTitle")}
              data-focus-ring="container"
              className={FIELD}
            />
            <Button
              type="button"
              disabled={busy || code.trim().length === 0}
              onClick={() => void joinTable()}
            >
              {t("party.join")}
            </Button>
          </div>
        </section>
      ) : null}

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
        /*
          L'histoire ouverte tient la colonne de gauche sur deux rangs : c'est
          celle qu'on vient reprendre, les autres sont un choix qu'on fait de
          temps en temps.
        */
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((story) => (
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

          {/* Ce qui reste, dit comme une place et non comme un manque : une
              histoire vide ne coute rien. */}
          {free > 0 ? (
            <li className="flex flex-col justify-center rounded-card border border-dashed border-line p-5">
              <span aria-hidden="true" className="flex gap-2">
                {Array.from({ length: Math.min(free, 3) }, (_, index) => (
                  <span
                    key={index}
                    style={{ borderRadius: "var(--radius-portal)" }}
                    className="h-12 w-9 border border-dashed border-line"
                  />
                ))}
              </span>
              <p className="mt-4 font-voice text-subtitle text-pretty text-vellum">
                {t("free", { count: free })}
              </p>
              <p className="mt-2 text-ui-sm text-pretty text-vellum-3">
                {t("freeHint")}
              </p>
              <Button
                type="button"
                variant="secondary"
                className="mt-4 self-start"
                disabled={busy}
                onClick={() => void create()}
              >
                {t("new")}
              </Button>
            </li>
          ) : null}
        </ul>
      )}

      <div aria-live="polite" className="min-h-5">
        {error ? (
          <p className="text-ui-sm text-ember">{error}</p>
        ) : outcome ? (
          <div className="flex items-start gap-3 rounded-card border border-arcane/40 bg-arcane/8 px-4 py-3.5">
            <span
              aria-hidden="true"
              className="mt-2 h-2 w-2 flex-none rounded-full bg-arcane"
            />
            <p className="text-ui-sm text-pretty text-vellum-2">
              <span className="mr-2 font-ui text-caption font-medium tracking-widest text-vellum uppercase">
                {t("outcome.title")}
              </span>
              {outcomeText(outcome, t)}
            </p>
          </div>
        ) : null}
      </div>
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

/*
  Les refus de la table, dits dans la langue de la liste : une table pleine
  et une histoire déjà commencée ne se lisent pas de la même façon.
*/
function partyErrorKey(
  caught: unknown,
  t: ReturnType<typeof useTranslations<"Stories">>,
  max: number,
): string {
  if (!(caught instanceof PartyError)) return t("error");

  switch (caught.code) {
    case "in_party":
      return t("party.alreadySeated");
    case "party_full":
      return t("party.partyFull");
    case "locked":
      return t("party.joinLocked");
    case "stories_full":
      return t("full", { max });
    default:
      return t("error");
  }
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
  const named = story.name ?? t("untitled");

  return (
    <li
      data-world={themed ? (story.name ?? "") : undefined}
      style={themed ? ({ "--world-hue": story.accentHue } as CSSProperties) : undefined}
      className={[
        "flex flex-col gap-5 rounded-card border bg-abyss p-5",
        story.current
          ? "border-accent/50 sm:col-span-2 lg:col-span-1 lg:row-span-2"
          : "border-line",
      ].join(" ")}
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {story.current ? <Tag tone="accent">{t("open")}</Tag> : null}
          {story.visiting ? <Tag tone="arcane">{t("visiting")}</Tag> : null}
          {story.party ? <Tag tone="brass">{t("party.tag")}</Tag> : null}
          <Tag tone={story.step === "failed" ? "ember" : "muted"}>
            {t(`step.${story.step}`)}
          </Tag>
        </div>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h2
              className={[
                "font-voice text-balance",
                story.current ? "text-title" : "text-subtitle",
                themed ? "text-accent" : "text-vellum",
              ].join(" ")}
            >
              {named}
            </h2>
            <p className="mt-1 text-caption text-vellum-3">
              {t("startedOn", {
                date: format.dateTime(new Date(story.createdAt), {
                  dateStyle: "medium",
                }),
              })}
            </p>
          </div>

          {/* Chaque monde a sa constellation, comme le Lore le promet. Un
              monde sans nom n'en a pas : elle se dérive de lui. */}
          {story.name ? (
            <Constellation
              name={story.name}
              className={story.current ? "h-16 w-32" : "h-10 w-20"}
            />
          ) : null}
        </div>

        {/* Où en est le parcours, pour une histoire qui n'a pas encore son
            monde. Trois crans, ceux que le joueur traverse. */}
        {story.step === "ready" ? null : (
          <>
            <ul aria-hidden="true" className="mt-4 flex gap-1.5">
              {(["inspiration", "character", "generating"] as const).map((stage, index) => (
                <li
                  key={stage}
                  className={[
                    "h-1 flex-1 rounded-xs",
                    index <= (JOURNEY as readonly string[]).indexOf(story.step) ? "bg-brass" : "bg-mist",
                  ].join(" ")}
                />
              ))}
            </ul>
            <p className="mt-3 text-ui-sm text-pretty text-vellum-3">
              {t(`awaiting.${story.step}` as never)}
            </p>
          </>
        )}
      </div>

      {/* Qui on y joue, et où en est son histoire. Sur l'ouverte seulement :
          c'est la seule que la table sert, et lire le monde des autres
          demanderait un appel par carte. */}
      {story.current && story.step === "ready" ? <PlayingAs /> : null}

      {/* Ouvert ou fermé aux visiteurs. Fermé par défaut : un monde appartient
          à son créateur tant qu'il n'a pas dit le contraire. Un monde emprunté
          ne s'ouvre pas : ce n'est pas le sien. */}
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

// Les trois crans du parcours, dans l'ordre ou on les traverse.
const JOURNEY = ["inspiration", "character", "generating"] as const;

/*
  Qui le joueur incarne dans l'histoire ouverte, et où elle en est.

  Lu sur `GET /world`, qui sert déjà l'histoire ouverte : c'est un appel de
  plus sur cet écran, et un seul, la table n'en servant qu'une à la fois.
  Silencieux, parce qu'une carte sans son personnage reste jouable.
*/
function PlayingAs() {
  const t = useTranslations("Stories");
  const tGame = useTranslations("Game");
  const [world, setWorld] = useState<WorldView | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchWorld(controller.signal)
      .then(setWorld)
      .catch(() => {});

    return () => controller.abort();
  }, []);

  if (!world) return null;

  return (
    <div className="flex items-start gap-4 rounded-card border border-line p-4">
      <span
        aria-hidden="true"
        style={{ borderRadius: "var(--radius-portal)" }}
        className="grid h-14 w-11 flex-none place-items-center border border-accent/40 bg-mist pt-2 font-voice text-subtitle text-accent"
      >
        {world.character.name.slice(0, 1)}
      </span>
      <div className="min-w-0">
        <p className="text-ui-sm text-vellum">
          {world.character.name}
          {world.story.act !== null && world.story.act <= world.story.acts ? (
            <span className="text-vellum-3">
              {" · "}
              {tGame("act", { act: world.story.act, acts: world.story.acts })}
            </span>
          ) : null}
        </p>
        {world.story.title ? (
          <p className="mt-1 font-voice text-ui-sm text-pretty text-vellum-2 italic">
            {`\u00ab\u00a0${world.story.title}\u00a0\u00bb`}
          </p>
        ) : (
          <p className="mt-1 text-caption text-pretty text-vellum-3">
            {t("playingAs")}
          </p>
        )}
      </div>
    </div>
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
