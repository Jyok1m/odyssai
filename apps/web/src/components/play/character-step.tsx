"use client";

import {
  CHARACTER_MESSAGE_MAX_CHARS,
  type Arrival,
  type CharacterDraft,
  type ConversationMessage,
} from "@odyssai/schemas";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { OutOfCredits } from "@/components/billing/out-of-credits";
import { AutoGrowTextarea } from "@/components/ui/auto-grow-textarea";
import { Button } from "@/components/ui/button";
import { DangerAction } from "@/components/ui/danger-action";
import { Spinner } from "@/components/ui/spinner";
import { isOutOfCredits } from "@/lib/billing";
import {
  CharacterError,
  extractCharacter,
  fetchConversation,
  resetCharacter,
  sendCharacterMessage,
} from "@/lib/character";

import { CharacterSheetForm } from "./character-sheet-form";
import { StepCard } from "./step-card";

interface Props {
  initial: CharacterDraft | null;
  /*
    Comment ce personnage entre dans ce monde. Un voyageur arrive avec sa
    fiche : il n'y a pas de conversation de création à lui ouvrir, et lui en
    proposer une lui ferait payer des messages pour réécrire ce qu'il a déjà.
  */
  arrival: Arrival | null;
  saving: boolean;
  error: string | null;
  onAdvance: (character: CharacterDraft) => void;
}

// Une fiche proposée ferme la conversation et ouvre le formulaire.
type Proposal = { character: CharacterDraft; missing: string[] } | null;

export function CharacterStep({ initial, arrival, saving, error, onAdvance }: Props) {
  const t = useTranslations("Play");

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [canExtract, setCanExtract] = useState(false);
  const [turnsLeft, setTurnsLeft] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  // La réserve vide n'est pas une panne : ce qu'il faut montrer est un lien.
  const [empty, setEmpty] = useState(false);

  // Une fiche déjà enregistrée rouvre directement le formulaire : le joueur
  // qui revient veut la corriger, pas reprendre la conversation.
  const [proposal, setProposal] = useState<Proposal>(
    initial ? { character: initial, missing: [] } : null,
  );

  const tDanger = useTranslations("Danger");
  const [resetError, setResetError] = useState<string | null>(null);

  const thread = useRef<HTMLOListElement>(null);
  const streamed = useRef("");

  const load = (signal?: AbortSignal) =>
    fetchConversation(signal)
      .then((conversation) => {
        setMessages(conversation.messages);
        setCanExtract(conversation.canExtract);
        setTurnsLeft(conversation.turnsLeft);
      })
      .catch((caught: unknown) => {
        if (signal?.aborted) return;
        setChatError(t(errorKey(caught)));
      });

  useEffect(() => {
    const controller = new AbortController();

    void load(controller.signal);

    return () => controller.abort();
    // `load` change à chaque rendu et n'a pas à relancer cet effet : c'est
    // l'arrivée sur l'étape qui le déclenche, une seule fois.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  // Le fil suit toujours le dernier message : contrairement au guide, il n'y a
  // pas d'historique ancien à relire au-dessus.
  useEffect(() => {
    const element = thread.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const send = async () => {
    const content = input.trim();
    if (content.length === 0 || streaming) return;

    setInput("");
    setChatError(null);
    setEmpty(false);
    setStreaming(true);
    streamed.current = "";

    // Le modèle a reconnu une demande de fiche : l'écran la dresse à la fin du
    // flux plutôt que de renvoyer le joueur au bouton, qu'il vient d'ignorer.
    let asked = false;

    const now = new Date().toISOString();
    setMessages((current) => [
      ...current,
      { id: `local-${now}`, role: "user", content, createdAt: now },
      { id: `local-${now}-reply`, role: "assistant", content: "", createdAt: now },
    ]);

    try {
      await sendCharacterMessage(content, (event) => {
        if (event.type === "delta") {
          streamed.current += event.text;
          const text = streamed.current;
          setMessages((current) => {
            const next = [...current];
            next[next.length - 1] = { ...next[next.length - 1]!, content: text };
            return next;
          });
        }
        if (event.type === "done") {
          setTurnsLeft(event.turnsLeft);
          setCanExtract(event.canExtract);
          asked = event.sheet;
        }
        if (event.type === "error") setChatError(t("errorGeneric"));
      });
    } catch (caught: unknown) {
      if (isOutOfCredits(caught)) setEmpty(true);
      else setChatError(t(errorKey(caught)));
      // Le message parti reste affiché : il est enregistré côté serveur.
      setMessages((current) => current.filter((message) => message.content !== ""));
    } finally {
      setStreaming(false);
    }

    // Après le flux, et non dans son événement : dresser la fiche remplace la
    // conversation par le formulaire, ce qui n'a de sens qu'une fois lue.
    if (asked) await draft();
  };

  const draft = async () => {
    setDrafting(true);
    setChatError(null);

    try {
      const result = await extractCharacter();
      setProposal({ character: result.character, missing: result.missing });
    } catch (caught: unknown) {
      setChatError(t(errorKey(caught)));
    } finally {
      setDrafting(false);
    }
  };

  const carried = arrival === "voyageur";

  /*
    La conversation et la fiche côte à côte, et non l'une à la place de
    l'autre : on corrige une fiche en relisant ce qui l'a produite, et la
    faire disparaître pour la corriger obligeait à se souvenir.

    Un voyageur n'a pas de conversation : il arrive avec sa fiche, et lui en
    ouvrir une lui ferait repayer ce qu'il a déjà écrit.
  */
  const sheet = proposal ? (
    <StepCard
      rank={3}
      label={t("sheet.title")}
      title={carried ? t("traveller.title") : t("sheet.lead")}
      aside={
        <span className="text-caption text-vellum-3">
          {carried ? t("traveller.lead") : t("sheet.drawnFrom")}
        </span>
      }
    >
      <CharacterSheetForm
        initial={proposal.character}
        missing={proposal.missing}
        saving={saving}
        error={error}
        onSubmit={onAdvance}
        onBack={carried ? undefined : () => setProposal(null)}
      />
    </StepCard>
  ) : null;

  if (carried && sheet) return sheet;

  const conversation = (
    <StepCard
      rank={3}
      label={t("steps.character")}
      title={t("character.title")}
      aside={
        <span className="text-caption text-vellum-3">
          {!canExtract
            ? t("character.keepTalking")
            : turnsLeft === 0
              ? t("character.turnsOver")
              : t("character.turnsLeft", { count: turnsLeft ?? 0 })}
        </span>
      }
    >
      <p className="max-w-measure text-ui-sm text-pretty text-vellum-2">
        {t("character.lead")}
      </p>

      <ol
        ref={thread}
        className="mt-5 flex max-h-96 flex-col gap-5 overflow-y-auto overscroll-contain px-1"
      >
        {messages.map((message) => (
          <li key={message.id}>
            {message.role === "user" ? (
              <p className="ml-auto max-w-17/20 rounded-card bg-mist px-4 py-2.5 text-ui-sm text-vellum">
                <span className="sr-only">{t("character.you")} : </span>
                {message.content}
              </p>
            ) : (
              <div className="max-w-23/25">
                <p className="text-caption text-vellum-3">
                  {t("character.guide")}
                </p>
                <p className="mt-1 text-ui-sm whitespace-pre-wrap text-vellum">
                  {message.content || t("character.thinking")}
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
          void send();
        }}
      >
        {/* La bordure porte l'indication de focus, d'où le liseré global
            neutralisé ici : les deux ensemble font un double cadre. */}
        <div
          data-focus-ring="container"
          className="flex items-end gap-2 rounded-card border border-line bg-ink py-2 pr-2 pl-3.5 transition-colors focus-within:border-accent"
        >
          <label htmlFor="character-message" className="sr-only">
            {t("character.inputLabel")}
          </label>
          <AutoGrowTextarea
            id="character-message"
            value={input}
            maxLength={CHARACTER_MESSAGE_MAX_CHARS}
            placeholder={t("character.placeholder")}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              // Pendant une composition IME, Entrée valide un caractère et
              // ne doit surtout pas envoyer le message.
              if (
                event.key !== "Enter" ||
                event.shiftKey ||
                event.nativeEvent.isComposing
              )
                return;
              event.preventDefault();
              void send();
            }}
          />
          <Button
            type="submit"
            size="sm"
            disabled={input.trim().length === 0 || streaming}
          >
            {t("character.send")}
          </Button>
        </div>
      </form>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        {/* L'extraction ne diffuse rien : sans ce cercle, rien ne bougeait à
            l'écran pendant l'appel, et le bouton grisé se lisait comme cassé. */}
        {drafting ? (
          <Spinner label={t("character.drafting")} />
        ) : (
          <Button
            type="button"
            variant={proposal ? "secondary" : "primary"}
            disabled={!canExtract || streaming}
            onClick={() => void draft()}
          >
            {proposal ? t("character.redraft") : t("character.draft")}
          </Button>
        )}

        {/* Repartir de zéro sur le personnage seul : la conversation et le
            brouillon partent, l'inspiration reste. Derrière un mot à taper,
            comme tout ce qui ne se défait pas. */}
        <DangerAction
          label={tDanger("character.label")}
          title={tDanger("character.title")}
          lead={tDanger("character.lead")}
          confirmLabel={tDanger("character.confirm")}
          busyLabel={tDanger("character.busy")}
          error={resetError}
          consequences={
            <ul className="space-y-1.5">
              <li>{tDanger("character.gone")}</li>
              <li>{tDanger("character.credits")}</li>
              <li className="text-vellum-3">{tDanger("character.kept")}</li>
            </ul>
          }
          onConfirm={async () => {
            setResetError(null);
            try {
              await resetCharacter();
              setProposal(null);
              setChatError(null);
              await load();
            } catch (caught: unknown) {
              setResetError(t(errorKey(caught)));
            }
          }}
        />
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-ui-sm text-ember">
        {empty ? <OutOfCredits /> : chatError}
      </p>
    </StepCard>
  );

  if (!sheet) return conversation;

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {conversation}
      {sheet}
    </div>
  );
}

/*
  Rend la clé de traduction et non le texte : le traducteur de next-intl est
  typé par ses clés, et une fonction qui prendrait un `string` ne lui serait
  pas assignable.
*/
function errorKey(caught: unknown) {
  if (!(caught instanceof CharacterError)) return "errorGeneric" as const;

  switch (caught.code) {
    case "refused":
      return "character.refused" as const;
    case "conversation_over":
      return "character.turnsOver" as const;
    case "too_short":
      return "character.keepTalking" as const;
    case "locked":
      return "locked" as const;
    // Le modèle n'a pas encore été retenu, ou le fournisseur a refusé.
    case "upstream_error":
      return "character.unavailable" as const;
    default:
      return "errorGeneric" as const;
  }
}
