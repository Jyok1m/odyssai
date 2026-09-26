"use client";

import {
  TURN_MESSAGE_MAX_CHARS,
  type Attribute,
  type AttributeStanding,
  type Health,
  type PublicEntity,
  type PublicOutcome,
  type RollRecord,
  type ScenePresence,
  type TurnMessage,
  type WorldView,
} from "@odyssai/schemas";
import { useLocale, useTranslations } from "next-intl";
import toast from "react-hot-toast";
import { useEffect, useRef, useState } from "react";

import { OutOfCredits } from "@/components/billing/out-of-credits";
import { Panel, Tag } from "@/components/ui/panel";
import { AutoGrowTextarea } from "@/components/ui/auto-grow-textarea";
import { Button } from "@/components/ui/button";
import { isOutOfCredits } from "@/lib/billing";
import { TurnError, fetchHistory, playTurn } from "@/lib/turn";

/*
  La table de jeu.

  Le meneur mène, le joueur répond. Ce qui change d'état pendant un tour est
  remonté à la coquille, qui tient les panneaux : la fiche, le dernier jet, ce
  qu'on porte et ce que le monde vient d'apprendre se lisent à côté du récit,
  pas dedans.
*/
export type TableEvents = {
  carrying(items: string[], gained: string[]): void;
  rolled(roll: RollRecord | null): void;
  grew(attribute: Attribute, standing: AttributeStanding): void;
  // L'état après le tour, et ce qu'il a coûté.
  hurt(health: Health, harm: number): void;
  // Qui se tient dans la scène, relu par le code dans le récit.
  staged(present: ScenePresence[]): void;
  learned(entity: PublicEntity): void;
  // Le tour est fini : combien de faits sont entrés au canon, et un de plus.
  played(canon: number): void;
};

export function GameChat({
  world,
  report,
}: {
  world: WorldView;
  report: TableEvents;
}) {
  const t = useTranslations("Game");
  const locale = useLocale();

  const [messages, setMessages] = useState<TurnMessage[]>([]);
  const [input, setInput] = useState("");
  /*
    Le jet en deux temps. `awaiting` dit qu'une action attend son dé ; le
    résultat, lui, se range sous le message qu'il a tranché.
  */
  const [awaiting, setAwaiting] = useState(false);
  // Le jet et le lore de la séance, rangés par le message qu'ils suivent : un
  // tour se relit avec ce qui l'a décidé, pas dans un panneau à part.
  const [rolls, setRolls] = useState<Record<string, RollRecord>>({});
  const [notes, setNotes] = useState<Record<string, PublicEntity[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Distinct du message d'erreur : la réserve vide n'est pas une panne, et ce
  // qu'il faut montrer est un lien, pas une phrase.
  const [empty, setEmpty] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const thread = useRef<HTMLOListElement>(null);
  const streamed = useRef("");
  const opened = useRef(false);

  useEffect(() => {
    const controller = new AbortController();

    fetchHistory(controller.signal)
      .then((history) => {
        setMessages(history.messages);
        report.carrying(history.inventory, []);
        report.rolled(history.lastRoll);
        report.staged(history.scene);
        setLoaded(true);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(t(errorKey(caught)));
        setLoaded(true);
      });

    return () => controller.abort();
    /*
      `report` est mémoïsé par la coquille, mais l'inscrire en dépendance
      ferait dépendre la lecture de l'historique d'un détail d'implémentation
      du parent : le jour où il cesserait de l'être, la partie se relirait à
      chaque rendu.
    */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  // Le fil suit toujours le dernier message : une partie se lit vers l'avant.
  useEffect(() => {
    const element = thread.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  /*
    À plusieurs, le journal vit sans soi : les autres jouent, et leurs tours
    arrivent. Une relecture paisible tant qu'aucun tour local n'est en vol :
    en pleine narration, c'est le flux qui écrit, et relire par-dessus
    écraserait la bulle en cours.
  */
  useEffect(() => {
    if (!world.party || !loaded) return;

    const interval = setInterval(() => {
      if (busy) return;

      fetchHistory()
        .then((history) => {
          setMessages((current) =>
            history.messages.length > current.length ? history.messages : current,
          );
        })
        .catch(() => {
          // Une relecture manquée n'est pas une panne de la partie : la
          // prochaine relit, et le joueur qui joue voit le tour s'écrire.
        });
    }, 5_000);

    return () => clearInterval(interval);
  }, [world.party, busy, loaded]);

  const play = async (request: Parameters<typeof playTurn>[0]) => {
    if (busy) return;

    setBusy(true);
    setError(null);
    setEmpty(false);
    streamed.current = "";

    const now = new Date().toISOString();
    const seq = messages.length;
    const replyId = `local-${now}-reply`;

    // À l'ouverture, le joueur n'a rien dit : seule la réponse du meneur
    // s'ajoute, et elle prend le premier rang.
    const said: TurnMessage[] =
      request.kind === "open" || request.kind === "roll"
        ? []
        : [
            {
              id: `local-${now}`,
              seq,
              role: "user",
              content: request.kind === "fate" ? t("fateSaid") : request.content,
              // Dans une table, son nom au-dessus de sa phrase : le journal
              // se lit comme une conversation de groupe.
              author: world.character.name,
              erased: false,
              outcome: null,
              request: request.kind,
              createdAt: now,
            },
          ];

    setMessages((current) => [
      ...current,
      ...said,
      {
        id: replyId,
        seq: request.kind === "open" ? seq : seq + 1,
        role: "assistant",
        content: "",
        // La réponse du meneur est celle du groupe, jamais signée.
        author: null,
        erased: false,
        outcome: null,
        request: request.kind,
        createdAt: now,
      },
    ]);

    const patch = (values: Partial<TurnMessage>) =>
      setMessages((current) => {
        const next = [...current];
        next[next.length - 1] = { ...next[next.length - 1]!, ...values };
        return next;
      });

    try {
      await playTurn(request, (event) => {
        if (event.type === "delta") {
          streamed.current += event.text;
          patch({ content: streamed.current });
        }
        if (event.type === "done") {
          patch({ outcome: event.outcome });
          report.played(event.learned);
        }
        if (event.type === "error") setError(t("errorGeneric"));

        /*
          Premier temps : rien n'a été généré ni débité. La bulle vide du
          meneur n'a plus lieu d'être, la phrase du joueur reste.
        */
        if (event.type === "roll_required") {
          setAwaiting(true);
          setMessages((current) => current.slice(0, -1));
        }

        if (event.type === "carrying") report.carrying(event.items, event.gained);

        if (event.type === "scene") report.staged(event.present);

        if (event.type === "health") {
          report.hurt(
            { hp: event.hp, hpMax: event.hpMax, condition: event.condition },
            event.harm,
          );
        }

        /*
          Un lore nouveau ou révélé. Il se pose sous le récit qui l'a fait
          naître, et rejoint le codex du panneau : une découverte se lit une
          fois dans la scène, et se retrouve ensuite.
        */
        if (event.type === "lore") {
          const entry = { name: event.name, kind: event.kind, known: event.known };
          setNotes((current) => ({
            ...current,
            [replyId]: [...(current[replyId] ?? []), entry],
          }));
          report.learned(entry);
        }

        /*
          Une marque se lit une fois, comme une montée : elle rejoint ensuite
          la fiche, où elle reste.
        */
        if (event.type === "mark") {
          toast(t("mark", { kind: t(`markKinds.${event.kind}` as never) }), {
            duration: 6000,
          });
        }

        if (event.type === "grew") {
          report.grew(event.attribute, {
            score: event.score,
            modifier: event.modifier,
            // La montée remet le compteur à zéro, comme le serveur vient de
            // l'écrire.
            uses: 0,
            needed: event.needed,
          });
        }

        if (event.type === "roll") {
          setAwaiting(false);
          const roll = {
            die: event.die,
            modifier: event.modifier,
            attribute: event.attribute,
            outcome: event.outcome,
          };
          setRolls((current) => ({ ...current, [replyId]: roll }));
          report.rolled(roll);
        }
      });
    } catch (caught: unknown) {
      if (isOutOfCredits(caught)) setEmpty(true);
      else setError(t(errorKey(caught)));
      // Une action expirée ne se rejoue pas toute seule : le joueur réécrit.
      setAwaiting(false);
      // Le tour est enregistré côté serveur même si la diffusion a échoué :
      // la réponse vide serait un mensonge, on la retire.
      setMessages((current) => current.filter((message) => message.content !== ""));
    } finally {
      setBusy(false);
    }
  };

  /*
    La première scène, jouée dès l'arrivée : c'est le meneur qui ouvre une
    partie, sinon le joueur arrive devant un champ vide.

    `opened` et non l'état des messages, qui se remplit pendant l'appel et
    déclencherait une seconde ouverture. L'API refuse dès qu'un tour existe,
    mais le lui demander deux fois serait déjà de trop.
  */
  useEffect(() => {
    if (!loaded || opened.current || messages.length > 0) return;
    opened.current = true;
    void play({ kind: "open" });
    // `play` change à chaque rendu et n'a pas à relancer cet effet : c'est
    // l'arrivée sur une partie vide qui le déclenche, une seule fois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, messages.length]);

  /*
    Le récit en PDF, dans un onglet. L'onglet s'ouvre dans le clic, avant le
    rendu : ouvert après, le navigateur le prendrait pour une fenêtre
    surgissante. La bibliothèque n'arrive qu'à ce moment.
  */
  const openPdf = async () => {
    const tab = window.open("", "_blank");
    if (!tab) {
      toast.error(t("pdfBlocked"));
      return;
    }

    try {
      const { renderStoryPdf, scenesOf } = await import("@/components/play/story-pdf");
      const blob = await renderStoryPdf({
        world,
        messages,
        strings: {
          kicker: t("pdf.kicker"),
          character: t("pdf.character"),
          act: act(world, t),
          scenes: t("pdf.scenes", { count: scenesOf(messages).length }),
          generated: t("pdf.generated"),
        },
        generatedOn: new Date().toLocaleDateString(locale, { dateStyle: "long" }),
      });
      tab.location.replace(URL.createObjectURL(blob));
    } catch (caught: unknown) {
      tab.close();
      console.error("rendu du récit impossible", caught);
      setError(t("errorGeneric"));
    }
  };

  const submit = (kind: "say" | "ask") => {
    const content = input.trim();
    if (!content) return;
    setInput("");
    void play({ kind, content });
  };

  // Le premier récit de la partie, seul à porter la lettrine : celui-là
  // commence l'histoire, les autres la continuent.
  const first = messages.find((message) => message.role === "assistant");

  return (
    <div className="space-y-5">
      <Panel>
        {/* L'acte en italique et le nom du monde en titre, comme le kit : un
            chapitre s'annonce, il ne se crie pas en capitales. */}
        <header className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div>
            <p className="font-voice text-control text-vellum-3 italic">
              {act(world, t)}
              {/* Le nom du monde passe en surtitre dès que l'acte en a un :
                  c'est le titre qui dit où l'on en est, le monde ne change
                  pas d'un tour à l'autre. */}
              {world.story.title ? (
                <span className="not-italic">
                  {" · "}
                  {world.name}
                </span>
              ) : null}
            </p>
            <h1 className="mt-1.5 font-voice text-title text-balance text-vellum">
              {world.story.title ?? world.name}
            </h1>
          </div>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={!loaded || messages.length === 0}
            onClick={() => void openPdf()}
          >
            {t("storyOpen")}
          </Button>
        </header>

        {!loaded ? (
          <p className="text-ui-sm text-vellum-3">{t("loading")}</p>
        ) : (
          <ol
            ref={thread}
            className="flex max-h-136 flex-col gap-6 overflow-y-auto overscroll-contain px-1"
          >
            {messages.length === 0 ? (
              <li className="text-ui-sm text-pretty text-vellum-3">{t("opening")}</li>
            ) : null}

            {group(messages).map((item) =>
              item.kind === "aside" ? (
                <li
                  key={item.question.id}
                  className="rounded-card border border-arcane/35 bg-arcane/6 px-4 py-3.5"
                >
                  <p className="text-caption text-arcane">{t("aside")}</p>
                  <p className="mt-2 text-ui-sm text-pretty text-vellum italic">
                    {item.question.content}
                  </p>
                  {item.answer ? (
                    <div className="mt-3 border-t border-arcane/25 pt-3">
                      <p className="font-voice text-ui-sm whitespace-pre-wrap text-vellum-2">
                        {item.answer.content || t("thinking")}
                      </p>
                      {(notes[item.answer.id] ?? []).map((entry) => (
                        <LoreNote key={`${item.answer!.id}-${entry.name}`} entry={entry} />
                      ))}
                    </div>
                  ) : null}
                </li>
              ) : (
              <li key={item.message.id}>
                {item.message.role === "user" ? (
                  <div className="ml-auto flex max-w-17/20 flex-col items-end gap-1">
                    {/* Dans une table, le nom de qui parle : le journal se
                        lit comme une conversation de groupe. En solo, le
                        screen-reader seul le portait, et il reste. */}
                    {item.message.author ? (
                      <p className="text-caption text-vellum-3">
                        {item.message.author}
                      </p>
                    ) : null}
                    {/* Le message d'un joueur parti : son rang reste, ses
                        mots non, et la bulle le dit plutôt que de rester vide. */}
                    {item.message.erased ? (
                      <p className="rounded-card bg-mist px-4 py-2.5 text-ui-sm text-vellum-3 italic">
                        {t("erased")}
                      </p>
                    ) : (
                      <p className="rounded-card bg-mist px-4 py-2.5 text-ui-sm text-vellum">
                        <span className="sr-only">
                          {item.message.author ?? t("you")} :{" "}
                        </span>
                        {item.message.content}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="max-w-measure">
                    {/* Le jet d'abord : le joueur a lancé, puis le meneur a
                        raconté, et c'est dans cet ordre que ça s'est passé. */}
                    {rolls[item.message.id] ? <RollPill roll={rolls[item.message.id]!} /> : null}

                    <p className="flex items-center gap-2 text-caption text-vellum-3">
                      {t("narrator")}
                      {item.message.outcome ? <Verdict outcome={item.message.outcome} /> : null}
                    </p>

                    {/* `font-voice` reste : c'est la voix du meneur. La taille
                        est celle des autres conversations du site. */}
                    <p
                      className={[
                        "mt-1.5 font-voice text-ui-sm whitespace-pre-wrap text-vellum",
                        item.message.id === first?.id ? "dropcap" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {item.message.content || t("thinking")}
                    </p>

                    {busy && item.message.content && item.message.id === messages.at(-1)?.id ? (
                      <p className="mt-2 font-voice text-ui-sm text-vellum-3 italic">
                        {t("writing")}
                        <span
                          aria-hidden="true"
                          className="ml-1 inline-block h-4 w-0.5 -translate-y-px bg-accent align-middle motion-safe:animate-pulse"
                        />
                      </p>
                    ) : null}

                    {(notes[item.message.id] ?? []).map((entry) => (
                      <LoreNote key={`${item.message.id}-${entry.name}`} entry={entry} />
                    ))}
                  </div>
                )}
              </li>
              ),
            )}
          </ol>
        )}
      </Panel>

      <Panel title={t("composer")}>
        {/*
          Premier temps : l'action attend son dé, et la saisie laisse la place
          au lancer. Rien n'a encore été débité.
        */}
        {awaiting ? (
          <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-ink p-5">
            <p className="text-ui-sm text-pretty text-center text-vellum-2">
              {t("rollPrompt")}
            </p>
            <Button type="button" disabled={busy} onClick={() => void play({ kind: "roll" })}>
              {t("rollAction")}
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit("say");
            }}
          >
            <div
              data-focus-ring="container"
              className="flex items-end gap-2 rounded-card border border-line bg-ink py-2 pr-2 pl-3.5 transition-colors focus-within:border-accent"
            >
              <label htmlFor="turn" className="sr-only">
                {t("inputLabel")}
              </label>
              <AutoGrowTextarea
                id="turn"
                value={input}
                maxLength={TURN_MESSAGE_MAX_CHARS}
                placeholder={t("placeholder")}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  // Pendant une composition IME, Entrée valide un caractère.
                  if (
                    event.key !== "Enter" ||
                    event.shiftKey ||
                    event.nativeEvent.isComposing
                  )
                    return;
                  event.preventDefault();
                  submit("say");
                }}
              />
              <Button type="submit" size="sm" disabled={!input.trim() || busy}>
                {t("send")}
              </Button>
            </div>
          </form>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          {/* Ici le chiffre reste caché : le joueur ne tente rien, il s'en
              remet au sort, et c'est le meneur qui dit ce qui arrive. */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void play({ kind: "fate" })}
          >
            {t("rollDie")}
          </Button>

          {/* Le même champ, l'autre geste : demander au lieu de tenter. La
              scène ne bouge pas, et le dé ne sert pas. */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || input.trim().length === 0}
            onClick={() => submit("ask")}
          >
            {t("askAction")}
          </Button>
        </div>

        <p aria-live="polite" className="mt-3 min-h-5 text-ui-sm text-ember">
          {empty ? <OutOfCredits /> : error}
        </p>
      </Panel>
    </div>
  );
}

/*
  Le jet, tel que le joueur l'a vu : son chiffre, ce que la fiche a pesé, et
  le total. Le chiffre nu ne dirait pas pourquoi il a réussi.
*/
function RollPill({ roll }: { roll: RollRecord }) {
  const t = useTranslations("Game");

  return (
    <p className="mb-3 inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-full border border-line bg-ink py-1.5 pr-3.5 pl-2 text-ui-sm tabular-nums text-vellum-2">
      <Die />
      <strong className="font-medium text-vellum">{roll.die}</strong>
      {roll.modifier !== 0 && roll.attribute ? (
        <span>
          {t("dieModifier", {
            sign: roll.modifier > 0 ? "+" : "−",
            value: Math.abs(roll.modifier),
            attribute: t(`attribute.${roll.attribute}` as never),
            total: roll.die + roll.modifier,
          })}
        </span>
      ) : (
        <span>{t("dieRolled")}</span>
      )}
      <Verdict outcome={roll.outcome} />
    </p>
  );
}

// Le d20 du kit, dessiné plutôt qu'importé : c'est le seul appelant.
export function Die({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      className={["flex-none text-accent", className].join(" ")}
    >
      <path d="M12 2 21 7.2v9.6L12 22 3 16.8V7.2z" />
      <path d="M12 2 7 12l5 10 5-10z" />
      <path d="M3 7.2 7 12l-4 4.8M21 7.2 17 12l4 4.8M7 12h10" />
    </svg>
  );
}

/*
  Ce que le monde vient d'apprendre, sous la scène qui l'a montré. Le cadre
  arcane du kit : ce n'est ni le récit ni une commande, c'est un fait nouveau.
*/
function LoreNote({ entry }: { entry: PublicEntity }) {
  const t = useTranslations("Game");

  return (
    <div className="mt-4 flex max-w-measure items-start gap-3 rounded-card border border-arcane/40 bg-arcane/8 px-3.5 py-3">
      <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 flex-none rounded-full bg-arcane" />
      <div>
        <p className="text-ui-sm text-vellum">
          {entry.name}
          <span className="text-vellum-3">
            {" · "}
            {t(`kind.${entry.kind}` as never)}
          </span>
        </p>
        <p className="mt-0.5 text-caption text-pretty text-vellum-2">{entry.known}</p>
      </div>
    </div>
  );
}

export function Verdict({ outcome }: { outcome: PublicOutcome }) {
  const t = useTranslations("Game");

  return (
    <Tag tone={outcome === "favorable" ? "accent" : "ember"}>
      {t(outcome === "favorable" ? "favourable" : "unfavourable")}
    </Tag>
  );
}

/*
  Le rang de l'acte, jamais son but. Au-delà du dernier, la partie continue en
  aventure libre : un arc donne un départ, pas une fin.
*/
/*
  Le fil, groupé : une question au meneur et sa réponse forment un aparté,
  qu'on lit comme tel, à part des scènes. Le reste passe tel quel.
*/
type Item =
  | { kind: "turn"; message: TurnMessage }
  | { kind: "aside"; question: TurnMessage; answer: TurnMessage | null };

function group(messages: TurnMessage[]): Item[] {
  const items: Item[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    const next = messages[index + 1];

    if (message.role === "user" && message.request === "ask") {
      const answer = next?.role === "assistant" && next.request === "ask" ? next : null;
      items.push({ kind: "aside", question: message, answer });
      if (answer) index += 1;
      continue;
    }

    items.push({ kind: "turn", message });
  }

  return items;
}

function act(world: WorldView, t: ReturnType<typeof useTranslations<"Game">>) {
  if (world.story.act === null || world.story.acts === 0) return t("noAct");
  if (world.story.act > world.story.acts) return t("free");
  return t("act", { act: world.story.act, acts: world.story.acts });
}

function errorKey(caught: unknown) {
  if (!(caught instanceof TurnError)) return "errorGeneric" as const;

  switch (caught.code) {
    case "refused":
      return "errorRefused" as const;
    case "rate_limited":
      return "errorRateLimited" as const;
    case "not_ready":
      return "errorNotReady" as const;
    case "unreachable":
      return "errorUnreachable" as const;
    case "unauthenticated":
      return "errorSignedOut" as const;
    case "upstream_error":
      return "errorUnavailable" as const;
    case "roll_expired":
      return "errorRollExpired" as const;
    /*
      La table joue : un autre membre est en pleine narration, la sienne
      vient dans un instant. Ce n'est pas une panne, et le message le dit,
      sinon le premier reflexe est de recliquer.
    */
    case "busy":
      return "errorBusy" as const;
    default:
      return "errorGeneric" as const;
  }
}
