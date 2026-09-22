"use client";

import {
  TURN_MESSAGE_MAX_CHARS,
  type PublicOutcome,
  type TurnMessage,
} from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import toast from "react-hot-toast";
import { useEffect, useRef, useState } from "react";

import { OutOfCredits } from "@/components/billing/out-of-credits";
import { CreditsBadge } from "@/components/play/credits-badge";
import { Story } from "@/components/play/story";
import { Button } from "@/components/ui/button";
import { isOutOfCredits } from "@/lib/billing";
import { TurnError, fetchHistory, playTurn } from "@/lib/turn";

/*
  La table de jeu.

  Le meneur mène, le joueur répond. Le dé ne montre jamais son chiffre : deux
  états seulement, et le détail se lit dans le récit.
*/
export function GameChat() {
  const t = useTranslations("Game");

  const [messages, setMessages] = useState<TurnMessage[]>([]);
  const [input, setInput] = useState("");
  // La lecture du récit, à côté du fil et non à sa place : on y revient pour
  // relire, puis on reprend la partie là où elle était.
  const [reading, setReading] = useState(false);
  /*
    Le jet en deux temps. `awaiting` dit qu'une action attend son dé, `roll`
    porte le résultat du dernier lancer, montré jusqu'au tour suivant.
  */
  const [awaiting, setAwaiting] = useState(false);
  // Incrémenté à chaque tour joué : c'est ce qui fait relire la réserve.
  const [played, setPlayed] = useState(0);
  // Ce que le personnage porte, rendu par l'historique puis suivi au fil des
  // tours : c'est le serveur qui decide, l'ecran ne fait que l'afficher.
  const [carrying, setCarrying] = useState<string[]>([]);
  const [roll, setRoll] = useState<{
    die: number;
    modifier: number;
    attribute: string | null;
    outcome: PublicOutcome;
  } | null>(null);
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
        setCarrying(history.inventory);
        setLoaded(true);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(t(errorKey(caught)));
        setLoaded(true);
      });

    return () => controller.abort();
  }, [t]);

  // Le fil suit toujours le dernier message : une partie se lit vers l'avant.
  useEffect(() => {
    const element = thread.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);


  const play = async (request: Parameters<typeof playTurn>[0]) => {
    if (busy) return;

    setBusy(true);
    setError(null);
    setEmpty(false);
    setRoll(null);
    streamed.current = "";

    const now = new Date().toISOString();
    const seq = messages.length;

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
              outcome: null,
              createdAt: now,
            },
          ];

    setMessages((current) => [
      ...current,
      ...said,
      {
        id: `local-${now}-reply`,
        seq: request.kind === "open" ? seq : seq + 1,
        role: "assistant",
        content: "",
        outcome: null,
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
          setPlayed((count) => count + 1);
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

        // Une montée se lit une fois, à part du verdict du tour.
        if (event.type === "carrying") setCarrying(event.items);

        // Un lore nouveau ou révélé : une nouvelle en soi, qui se lit une fois.
        if (event.type === "lore") {
          toast(t("lore", { name: event.name }), { duration: 6000 });
        }

        if (event.type === "grew") {
          toast.success(
            t("grew", {
              attribute: t(`attribute.${event.attribute}` as never),
              score: event.score,
            }),
          );
        }

        if (event.type === "roll") {
          setAwaiting(false);
          setRoll({
            die: event.die,
            modifier: event.modifier,
            attribute: event.attribute,
            outcome: event.outcome,
          });
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

  if (!loaded) {
    return <p className="text-ui-sm text-vellum-3">{t("loading")}</p>;
  }

  return (
    <section className="rounded-card border border-line bg-abyss p-4 shadow-2xl shadow-ink/50 sm:p-6">
      <div className="mb-4 flex items-center gap-3">
        <CreditsBadge refreshKey={played} />
        {/* Ce que le personnage porte. Des noms, jamais un effet : le meneur
            les raconte, le moteur ne les calcule pas. */}
        {carrying.length > 0 ? (
          <span className="text-caption text-vellum-3">
            {t("carrying", { items: carrying.join(", ") })}
          </span>
        ) : null}
        {/* `ml-auto` et non `justify-between` : le compteur disparaît quand la
            facturation ne répond pas, et le bouton resterait alors à gauche. */}
        <Button
          className="ml-auto"
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => setReading((open) => !open)}
        >
          {reading ? t("storyClose") : t("storyOpen")}
        </Button>
      </div>

      {reading ? <Story messages={messages} /> : <ol
        ref={thread}
        className="flex max-h-[32rem] flex-col gap-5 overflow-y-auto overscroll-contain px-1"
      >
        {messages.length === 0 ? (
          <li className="text-ui-sm text-pretty text-vellum-3">{t("opening")}</li>
        ) : null}

        {messages.map((message) => (
          <li key={message.id}>
            {message.role === "user" ? (
              <p className="ml-auto max-w-[85%] rounded-card bg-mist px-4 py-2.5 text-ui-sm text-vellum">
                <span className="sr-only">{t("you")} : </span>
                {message.content}
              </p>
            ) : (
              <div className="max-w-[92%]">
                <p className="flex items-center gap-2 text-caption text-vellum-3">
                  {t("narrator")}
                  {message.outcome ? <Verdict outcome={message.outcome} /> : null}
                </p>
                {/* `font-voice` reste : c'est la voix du meneur, pas de
                    l'interface. La taille, elle, est celle de la conversation
                    et non `text-narration` : dans un fil, le recit et ce que
                    le joueur repond se lisent l'un apres l'autre, et deux
                    echelles y font deux polices. */}
                <p className="mt-1.5 font-voice text-ui-sm whitespace-pre-wrap text-vellum">
                  {message.content || t("thinking")}
                </p>
              </div>
            )}
          </li>
        ))}
      </ol>}

      {/*
        Le jet, entre le fil et la saisie. Le chiffre sort du serveur et
        s'affiche tel quel : le joueur a lancé, il voit ce qu'il a fait.
      */}
      {roll ? (
        <p className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-card border border-line bg-ink py-3 text-ui-sm text-vellum-2">
          <span className="font-voice text-title text-accent">{roll.die}</span>
          {/* Le detail du jet, et non le seul total : le chiffre nu ne dirait
              pas pourquoi il a reussi, et la fiche doit se voir peser. */}
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
      ) : null}

      {/*
        Premier temps : l'action attend son dé, et la saisie laisse la place
        au lancer. Rien n'a encore été débité.
      */}
      {awaiting ? (
        <div className="mt-5 flex flex-col items-center gap-2 rounded-card border border-line bg-ink p-5">
          <p className="text-ui-sm text-pretty text-center text-vellum-2">
            {t("rollPrompt")}
          </p>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void play({ kind: "roll" })}
          >
            {t("rollAction")}
          </Button>
        </div>
      ) : (
      <form
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault();
          const content = input.trim();
          if (!content) return;
          setInput("");
          void play({ kind: "say", content });
        }}
      >
        <div
          data-focus-ring="container"
          className="flex items-end gap-2 rounded-card border border-line bg-ink py-2 pr-2 pl-3.5 transition-colors focus-within:border-accent"
        >
          <label htmlFor="turn" className="sr-only">
            {t("inputLabel")}
          </label>
          <textarea
            id="turn"
            rows={1}
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
              const content = input.trim();
              if (!content) return;
              setInput("");
              void play({ kind: "say", content });
            }}
            className="max-h-40 w-full resize-none self-center border-0 bg-transparent py-1.5 font-ui text-ui-sm text-vellum placeholder:text-vellum-3"
          />
          <Button type="submit" size="sm" disabled={!input.trim() || busy}>
            {t("send")}
          </Button>
        </div>
      </form>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4">
        {/* Ici le chiffre reste caché : le joueur ne tente rien, il s'en
            remet au sort, et c'est le meneur qui dit ce qui arrive. */}
        <Button
          type="button"
          variant="secondary"
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
          disabled={busy || input.trim().length === 0}
          onClick={() => {
            const content = input.trim();
            if (!content) return;
            setInput("");
            void play({ kind: "ask", content });
          }}
        >
          {t("askAction")}
        </Button>

        <p className="text-ui-sm text-vellum-3">{t("dieHint")}</p>
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-ui-sm text-ember">
        {empty ? <OutOfCredits /> : error}
      </p>
    </section>
  );
}

function Verdict({ outcome }: { outcome: PublicOutcome }) {
  const t = useTranslations("Game");

  return (
    <span
      className={[
        "rounded-full border px-2 py-0.5 text-tag",
        outcome === "favorable"
          ? "border-accent/50 text-accent"
          : "border-ember/50 text-ember",
      ].join(" ")}
    >
      {t(outcome === "favorable" ? "favourable" : "unfavourable")}
    </span>
  );
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
    default:
      return "errorGeneric" as const;
  }
}
