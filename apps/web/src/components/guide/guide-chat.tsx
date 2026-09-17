"use client";

import {
  GUIDE_QUESTION_MAX_CHARS,
  type GuideAnswerSource,
} from "@odyssai/schemas";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  GuideRequestError,
  askGuide,
  fetchSuggestions,
  requestGuidePass,
  solveTurnstile,
} from "@/lib/guide";

interface Turn {
  question: string;
  answer: string;
  source?: GuideAnswerSource;
  error?: string;
  partial?: boolean;
}

/** Au-delà, le champ défile au lieu de repousser le bouton hors de l'écran. */
const TEXTAREA_MAX_PX = 160;
/** Le compteur n'apparaît qu'à l'approche de la borne, pas à chaque frappe. */
const COUNTER_FROM = GUIDE_QUESTION_MAX_CHARS - 50;

export function GuideChat() {
  const t = useTranslations("Guide");
  const locale = useLocale() as Locale;

  const [suggestions, setSuggestions] = useState<
    { id: string; question: string }[]
  >([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const challengeRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLOListElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchSuggestions(locale, controller.signal)
      .then((response) => setSuggestions(response.suggestions))
      .catch(() => {
        // Sans suggestions la section reste utilisable : on n'affiche rien.
      });
    return () => controller.abort();
  }, [locale]);

  // Le champ grandit avec le texte. Remis à zéro d'abord, sinon scrollHeight
  // ne redescend jamais quand on efface.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "0px";
    field.style.height = `${Math.min(field.scrollHeight, TEXTAREA_MAX_PX)}px`;
  }, [input]);

  // Suit le flux, sauf si le visiteur est remonté lire une réponse précédente.
  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    const distance =
      thread.scrollHeight - thread.scrollTop - thread.clientHeight;
    if (distance < 80) thread.scrollTop = thread.scrollHeight;
  }, [turns]);

  // Le fil ne vit que dans ce composant : rien n'est conservé d'une visite à
  // l'autre, et chaque question part seule vers l'API.
  const update = (patch: Partial<Turn>) => {
    setTurns((previous) => {
      if (previous.length === 0) return previous;
      const next = [...previous];
      next[next.length - 1] = { ...next[next.length - 1]!, ...patch };
      return next;
    });
  };

  const run = async (question: string, allowRetry: boolean): Promise<void> => {
    const controller = new AbortController();
    abortRef.current = controller;

    await askGuide(
      { question, locale },
      (event) => {
        if (event.type === "meta") update({ source: event.source });
        if (event.type === "delta") {
          setTurns((previous) => {
            const next = [...previous];
            const last = next[next.length - 1]!;
            next[next.length - 1] = {
              ...last,
              answer: last.answer + event.text,
            };
            return next;
          });
        }
        if (event.type === "error") update({ error: t("errorUpstream") });
      },
      controller.signal,
    ).catch(async (error: unknown) => {
      // Un seul rattrapage : le défi obtenu, la question repart telle quelle.
      if (
        allowRetry &&
        error instanceof GuideRequestError &&
        error.code === "pass_required" &&
        challengeRef.current
      ) {
        const token = await solveTurnstile(challengeRef.current);
        await requestGuidePass(token);
        return run(question, false);
      }
      throw error;
    });
  };

  const ask = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || streaming) return;

    setInput("");
    setTurns((previous) => [...previous, { question: trimmed, answer: "" }]);
    setStreaming(true);

    try {
      await run(trimmed, true);
    } catch (error: unknown) {
      if (abortRef.current?.signal.aborted) update({ partial: true });
      else update({ error: messageFor(error, t) });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const started = turns.length > 0;

  return (
    // Le seul objet interactif du site. Le panneau ne fixe ni sa largeur ni sa
    // place : c'est la grille du hero qui le pose, pour qu'il entre dans le
    // premier ecran sans faire defiler.
    <section className="rounded-card border border-line bg-abyss p-4 shadow-2xl shadow-ink/50 sm:p-6">
      <div className="px-1">
        <h2 className="font-voice text-subtitle text-balance text-vellum">
          {t("title")}
        </h2>
        <p className="mt-2 text-ui-sm text-pretty text-vellum-2">
          {t("intro")}
        </p>
      </div>

      {/* Les amorces disparaissent dès la première question : elles ne
            servent qu'à démarrer, et elles tiennent trois lignes sur mobile. */}
      {!started && suggestions.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2 px-1">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id}>
              <Button
                variant="secondary"
                size="sm"
                disabled={streaming}
                onClick={() => void ask(suggestion.question)}
              >
                {suggestion.question}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {started && (
        <ol
          ref={threadRef}
          className="mt-5 flex max-h-80 flex-col gap-5 overflow-y-auto overscroll-contain px-1 sm:max-h-96"
        >
          {turns.map((turn, index) => (
            <li key={index} className="flex flex-col gap-3">
              <p className="ml-auto max-w-[85%] rounded-card bg-mist px-4 py-2.5 text-ui text-vellum">
                <span className="sr-only">{t("you")} : </span>
                {turn.question}
              </p>

              {/* Pas de bulle pour le guide : sa voix est le texte lui-même,
                    en serif, comme la narration du reste du site. */}
              <div
                className="max-w-[92%]"
                aria-busy={streaming && index === turns.length - 1}
              >
                <p className="text-caption text-vellum-3">{t("guide")}</p>
                {turn.answer ? (
                  <p className="mt-1 font-voice text-narration whitespace-pre-wrap text-vellum">
                    {turn.answer}
                  </p>
                ) : (
                  !turn.error && (
                    <p className="mt-1 text-ui text-vellum-3">
                      {t("thinking")}
                    </p>
                  )
                )}

                {turn.source === "degraded" && (
                  <p className="mt-3 text-ui-sm text-vellum-2">
                    {t("degradedLinks")}{" "}
                    <Link href="/concept" className="text-accent underline">
                      {t("linkConcept")}
                    </Link>
                    {", "}
                    <Link href="/univers" className="text-accent underline">
                      {t("linkUniverses")}
                    </Link>
                    {", "}
                    <Link href="/lore" className="text-accent underline">
                      {t("linkLore")}
                    </Link>
                  </p>
                )}

                {turn.partial && (
                  <p className="mt-2 text-ui-sm text-vellum-3">
                    {t("partial")}
                  </p>
                )}
                {turn.error && (
                  <p className="mt-2 text-ui-sm text-ember">{turn.error}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* Annoncée d'un bloc à la fin : un lecteur d'écran noierait
            l'utilisateur si chaque fragment y passait. */}
      <p aria-live="polite" className="sr-only">
        {!streaming && turns.at(-1)?.answer
          ? `${t("answerReady")} : ${turns.at(-1)!.answer}`
          : ""}
      </p>

      <form
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(input);
        }}
      >
        {/* La bordure porte l'indication de focus, d'où le liseré global
              neutralisé ici : les deux ensemble font un double cadre. */}
        <div
          data-focus-ring="container"
          className="flex items-end gap-2 rounded-card border border-line bg-ink py-2 pr-2 pl-3.5 transition-colors focus-within:border-accent"
        >
          <label htmlFor="guide-question" className="sr-only">
            {t("inputLabel")}
          </label>
          <textarea
            ref={fieldRef}
            id="guide-question"
            rows={1}
            value={input}
            maxLength={GUIDE_QUESTION_MAX_CHARS}
            placeholder={t("placeholder")}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              // Pendant une composition IME, Entrée valide un caractère et
              // ne doit surtout pas envoyer la question.
              if (
                event.key !== "Enter" ||
                event.shiftKey ||
                event.nativeEvent.isComposing
              )
                return;
              event.preventDefault();
              void ask(input);
            }}
            className="max-h-40 w-full resize-none self-center border-0 bg-transparent py-1.5 font-ui text-ui text-vellum placeholder:text-vellum-3"
          />

          {input.length >= COUNTER_FROM && (
            <span className="mb-2 shrink-0 text-caption tabular-nums text-vellum-3">
              {GUIDE_QUESTION_MAX_CHARS - input.length}
            </span>
          )}

          {streaming ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mb-0.5 shrink-0"
              onClick={() => abortRef.current?.abort()}
            >
              {t("stop")}
            </Button>
          ) : (
            <Button
              type="submit"
              size="sm"
              className="mb-0.5 shrink-0"
              disabled={input.trim().length === 0}
            >
              {t("send")}
            </Button>
          )}
        </div>

        {/* Entrée pour envoyer n'a pas de sens sur un clavier tactile. */}
        <p className="mt-2 hidden px-1 text-caption text-vellum-3 sm:block">
          {t("hint")} {t("separate")}
        </p>
        <p className="mt-2 px-1 text-caption text-vellum-3 sm:hidden">
          {t("separate")}
        </p>
        <div ref={challengeRef} className="mt-3 empty:mt-0" />
      </form>
    </section>
  );
}

function messageFor(
  error: unknown,
  t: ReturnType<typeof useTranslations<"Guide">>,
): string {
  if (!(error instanceof GuideRequestError)) return t("errorNetwork");

  if (error.code === "rate_limited") {
    return t("errorRateLimited", {
      minutes: Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60)),
    });
  }
  if (error.code === "busy") return t("errorBusy");
  if (error.code === "pass_unavailable" || error.code === "pass_required") {
    return t("errorNetwork");
  }
  return t("errorUpstream");
}
