"use client";

import {
  TURN_MESSAGE_MAX_CHARS,
  type PublicOutcome,
  type TurnMessage,
} from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { TurnError, fetchHistory, playTurn } from "@/lib/turn";

/**
 * La table de jeu.
 *
 * Le meneur mène, le joueur répond. Le dé ne montre jamais son chiffre : deux
 * états seulement, et le détail se lit dans le récit.
 */
export function GameChat() {
  const t = useTranslations("Game");

  const [messages, setMessages] = useState<TurnMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const thread = useRef<HTMLOListElement>(null);
  const streamed = useRef("");

  useEffect(() => {
    const controller = new AbortController();

    fetchHistory(controller.signal)
      .then((history) => {
        setMessages(history.messages);
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
    streamed.current = "";

    const now = new Date().toISOString();
    const seq = messages.length;

    setMessages((current) => [
      ...current,
      {
        id: `local-${now}`,
        seq,
        role: "user",
        content: request.kind === "fate" ? t("fateSaid") : request.content,
        outcome: null,
        createdAt: now,
      },
      {
        id: `local-${now}-reply`,
        seq: seq + 1,
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
        if (event.type === "done") patch({ outcome: event.outcome });
        if (event.type === "error") setError(t("errorGeneric"));
      });
    } catch (caught: unknown) {
      setError(t(errorKey(caught)));
      // Le tour est enregistré côté serveur même si la diffusion a échoué :
      // la réponse vide serait un mensonge, on la retire.
      setMessages((current) => current.filter((message) => message.content !== ""));
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return <p className="text-ui-sm text-vellum-3">{t("loading")}</p>;
  }

  return (
    <section className="rounded-card border border-line bg-abyss p-4 shadow-2xl shadow-ink/50 sm:p-6">
      <ol
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
                {/* font-voice : c'est de la narration, pas de l'interface. */}
                <p className="mt-1.5 font-voice text-narration whitespace-pre-wrap text-vellum">
                  {message.content || t("thinking")}
                </p>
              </div>
            )}
          </li>
        ))}
      </ol>

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

      <div className="mt-4 flex flex-wrap items-center gap-4">
        {/* Le joueur ne verra jamais le chiffre : il s'en remet au sort, et
            c'est le meneur qui dit ce qui arrive. */}
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => void play({ kind: "fate" })}
        >
          {t("rollDie")}
        </Button>
        <p className="text-ui-sm text-vellum-3">{t("dieHint")}</p>
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-ui-sm text-ember">
        {error}
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
    default:
      return "errorGeneric" as const;
  }
}
