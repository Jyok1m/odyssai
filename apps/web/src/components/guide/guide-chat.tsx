"use client";

import { GUIDE_QUESTION_MAX_CHARS, type GuideAnswerSource } from "@odyssai/schemas";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
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

export function GuideChat() {
  const t = useTranslations("Guide");
  const locale = useLocale() as Locale;

  const [suggestions, setSuggestions] = useState<{ id: string; question: string }[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const challengeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchSuggestions(locale, controller.signal)
      .then((response) => setSuggestions(response.suggestions))
      .catch(() => {
        // Sans suggestions la section reste utilisable : on n'affiche rien.
      });
    return () => controller.abort();
  }, [locale]);

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
            next[next.length - 1] = { ...last, answer: last.answer + event.text };
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

  return (
    <Container as="section" className="py-24 sm:py-32">
      <h2 className="font-voice text-title text-balance text-vellum">{t("title")}</h2>
      <p className="mt-4 max-w-measure text-ui text-pretty text-vellum-2">{t("intro")}</p>

      {suggestions.length > 0 && (
        <div className="mt-8">
          <p className="text-caption text-vellum-3">{t("suggestionsLabel")}</p>
          <ul className="mt-3 flex flex-wrap gap-2">
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
        </div>
      )}

      {turns.length > 0 && (
        <ol className="mt-10 flex max-w-measure flex-col gap-6">
          {turns.map((turn, index) => (
            <li key={index} className="flex flex-col gap-3">
              <p className="self-end rounded-card border border-line bg-mist px-4 py-2.5 text-ui text-vellum">
                <span className="sr-only">{t("you")} : </span>
                {turn.question}
              </p>

              <div
                className="rounded-card border border-line bg-abyss px-4 py-3"
                aria-busy={streaming && index === turns.length - 1}
              >
                <p className="text-caption text-vellum-3">{t("guide")}</p>
                {turn.answer ? (
                  <p className="mt-1.5 font-voice text-narration whitespace-pre-wrap text-vellum">
                    {turn.answer}
                  </p>
                ) : (
                  !turn.error && (
                    <p className="mt-1.5 text-ui text-vellum-3">{t("thinking")}</p>
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
                  <p className="mt-3 text-ui-sm text-vellum-3">{t("partial")}</p>
                )}
                {turn.error && (
                  <p className="mt-3 text-ui-sm text-ember">{turn.error}</p>
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
        className="mt-8 max-w-measure"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(input);
        }}
      >
        <div className="rounded-card border border-line bg-abyss px-3.5 pt-3 pb-2.5 transition-colors focus-within:border-accent">
          <label htmlFor="guide-question" className="block text-caption text-vellum-3">
            {t("inputLabel")}
          </label>
          <textarea
            id="guide-question"
            rows={2}
            value={input}
            maxLength={GUIDE_QUESTION_MAX_CHARS}
            placeholder={t("placeholder")}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              // Pendant une composition IME, Entrée valide un caractère et ne
              // doit surtout pas envoyer la question.
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void ask(input);
            }}
            className="mt-1 w-full resize-none border-0 bg-transparent font-ui text-ui text-vellum outline-none placeholder:text-vellum-3"
          />

          <div className="mt-1.5 flex items-center justify-between gap-3">
            <span className="text-caption text-vellum-3">{t("hint")}</span>
            <div className="flex items-center gap-2">
              <span className="text-caption text-vellum-3">
                {input.length} / {GUIDE_QUESTION_MAX_CHARS}
              </span>
              {streaming ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => abortRef.current?.abort()}
                >
                  {t("stop")}
                </Button>
              ) : (
                <Button type="submit" size="sm" disabled={input.trim().length === 0}>
                  {t("send")}
                </Button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-3 text-caption text-vellum-3">{t("separate")}</p>
        <div ref={challengeRef} className="mt-3 empty:mt-0" />
      </form>
    </Container>
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
