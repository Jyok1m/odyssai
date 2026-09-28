import { isRetryable, type LlmClient, type LlmStreamEvent, type LlmTrace } from '@odyssai/llm';
import {
  CHARACTER_ATTEMPTS_PER_CALL,
  CharacterDraftSchema,
  type CharacterDraft,
  type UiLocale,
} from '@odyssai/schemas';
import {
  CHARACTER_PROMPT,
  CHARACTER_SHEET_MARKER,
  type ConversationTurn,
} from '../prompts/character/v1.js';
import { splitTail } from '../turn/split-tail.js';
import { CHARACTER_EXTRACT_PROMPT } from '../prompts/character-extract/v1.js';

export {
  CHARACTER_OPENING,
  CHARACTER_SHEET_MARKER,
} from '../prompts/character/v1.js';
export type { ConversationTurn };

export const CHARACTER_PROMPT_VERSION = CHARACTER_PROMPT.id;
export const CHARACTER_EXTRACT_PROMPT_VERSION = CHARACTER_EXTRACT_PROMPT.id;

export interface CharacterModelConfig {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  extraBody?: Record<string, unknown>;
}

export interface CharacterTurnRequest {
  llm: LlmClient;
  config: CharacterModelConfig;
  locale: UiLocale;
  history: ConversationTurn[];
  message: string;
  signal?: AbortSignal;
  trace?: LlmTrace;
}

export interface CharacterUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  cachedTokens?: number;
}

export function buildCharacterMessages(
  locale: UiLocale,
  history: ConversationTurn[],
  message: string,
) {
  return CHARACTER_PROMPT.build(locale, history, message);
}

/*
  Un tour de conversation. Le texte est rendu au fil de l'eau, l'usage n'est
  connu qu'a la fin : l'appelant lit `usage()` une fois le flux epuise.

  Le marqueur de fiche est retire du texte par `splitTail`, donc ni diffuse ni
  enregistre : ce qui reste est la phrase adressee au joueur, et l'appelant lit
  `sheetRequested()` une fois le flux epuise pour savoir s'il faut la dresser.
*/
export function converseCharacter(request: CharacterTurnRequest): {
  chunks: AsyncIterable<string>;
  sheetRequested: () => boolean;
  usage: () => CharacterUsage;
} {
  const { llm, config, locale, history, message, signal, trace } =
    request;

  const split = splitTail(
    llm.streamChat({
      model: config.model,
      messages: buildCharacterMessages(locale, history, message),
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
      extraBody: config.extraBody,
      signal,
      trace,
    }),
    CHARACTER_SHEET_MARKER,
  );

  return {
    chunks: split.chunks,
    sheetRequested: split.seen,
    usage: () => split.usage(),
  };
}

function absorb(
  usage: CharacterUsage,
  event: Extract<LlmStreamEvent, { type: 'usage' }>,
): void {
  usage.model = event.model;
  usage.inputTokens = event.inputTokens;
  usage.outputTokens = event.outputTokens;
  usage.costUsd = event.costUsd;
  usage.cachedTokens = event.cachedTokens;
}

export interface CharacterExtractRequest {
  llm: LlmClient;
  config: CharacterModelConfig;
  locale: UiLocale;
  history: ConversationTurn[];
  signal?: AbortSignal;
  trace?: LlmTrace;
}

/*
  `partial` n'est pas un echec : le modele a rendu du JSON, mais des champs
  n'ont pas tenu le schema. On garde ce qui tient et l'ecran demande le reste,
  plutot que de tout jeter pour un age fantaisiste.

  `empty` en est un : une fiche dont aucun champ ne tient n'est pas une
  proposition, c'est un formulaire vide que le joueur aurait a remplir seul.

  `truncated` se distingue de `invalid_json` parce qu'il ne se corrige pas
  pareil : le modele a bute sur `maxOutputTokens`, et c'est un chiffre a
  relever plutot qu'un mauvais tirage. L'essai suivant part quand meme, le
  plafond ayant pu etre mange par un preambule qui ne reviendra pas ; ce que
  le nom sert a dire est ou chercher quand les deux essais tombent la.

  Les essais sont rendus tous ensemble dans `usages` : chacun a ete paye, et
  un rejeu qui ne se journalise pas fait mentir le cout de la fiche.
*/
export type CharacterExtractRejection =
  | 'invalid_json'
  | 'truncated'
  | 'empty'
  | 'upstream';

export type CharacterExtractResult =
  | {
      kind: 'ok';
      character: CharacterDraft;
      missing: string[];
      usages: CharacterUsage[];
    }
  | {
      kind: 'rejected';
      reason: CharacterExtractRejection;
      details: string;
      // Appels faits avant d'abandonner : un refus franc n'en fait qu'un.
      attempts: number;
      usages: CharacterUsage[];
    };

const FIELDS = ['name', 'gender', 'age', 'personality', 'attributes'] as const;

function unwrap(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? raw).trim();
}

/*
  La fiche tiree de la conversation. Elle rejoue, comme un noeud du graphe et
  pour la meme raison : une sortie illisible ou une panne de transport sont des
  accidents d'un appel, pas de la conversation, et sans second essai un joueur
  perdait douze echanges payes sur un JSON tronque.

  Le prompt du rejeu est le meme, a la temperature pres qui ne bouge pas : ce
  qu'on rejoue est le tirage, pas la consigne.
*/
export async function extractCharacter(
  request: CharacterExtractRequest,
): Promise<CharacterExtractResult> {
  const { llm, config, locale, history, signal, trace } = request;
  const messages = CHARACTER_EXTRACT_PROMPT.build(locale, history);

  const usages: CharacterUsage[] = [];
  let last: Extract<CharacterExtractResult, { kind: 'rejected' }> | null = null;

  for (let attempt = 1; attempt <= CHARACTER_ATTEMPTS_PER_CALL; attempt += 1) {
    const usage: CharacterUsage = {};
    let text = '';
    let stop = '';

    try {
      for await (const event of llm.streamChat({
        model: config.model,
        messages,
        maxOutputTokens: config.maxOutputTokens,
        temperature: config.temperature,
        extraBody: config.extraBody,
        signal,
        // L'essai est dans la trace : deux appels pour une fiche se lisent
        // autrement que deux fiches.
        trace: trace && {
          ...trace,
          metadata: { ...trace.metadata, attempt },
        },
      })) {
        if (event.type === 'text') text += event.text;
        if (event.type === 'stop') stop = event.reason;
        if (event.type === 'usage') absorb(usage, event);
      }
    } catch (error: unknown) {
      /*
        Une panne de transport. L'usage n'est journalise que si le fournisseur
        l'a rendu avant de rompre, ce que le `finally` tranche. Un abandon et
        un refus franc ne se rejouent pas, et la raison remonte telle que
        `LlmError` l'a formulee : elle ne porte ni cle ni prompt.
      */
      last = {
        kind: 'rejected',
        reason: 'upstream',
        details: String(error instanceof Error ? error.message : error),
        attempts: attempt,
        usages,
      };
      if (!isRetryable(error)) return last;
      continue;
    } finally {
      if (usage.inputTokens !== undefined) usages.push(usage);
    }

    const result = read(text, stop, attempt, usages);
    if (result.kind === 'ok') return result;
    last = result;
  }

  return last!;
}

// Ce que le modele a rendu, relu. Aucun appel ici : de quoi tester le tri.
function read(
  text: string,
  stop: string,
  attempts: number,
  usages: CharacterUsage[],
): CharacterExtractResult {
  // Le plafond de sortie nomme le refus : un JSON coupe et un modele bavard
  // ne se corrigent pas au meme endroit.
  const cut = stop === 'length';

  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrap(text));
  } catch {
    return {
      kind: 'rejected',
      reason: cut ? 'truncated' : 'invalid_json',
      details: `${text.length} caracteres rendus`,
      attempts,
      usages,
    };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      kind: 'rejected',
      reason: cut ? 'truncated' : 'invalid_json',
      details: 'objet JSON attendu',
      attempts,
      usages,
    };
  }

  // Champ par champ : un seul attribut hors bornes ne doit pas emporter le nom
  // et la personnalite avec lui.
  const source = parsed as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const field of FIELDS) {
    if (source[field] === undefined || source[field] === null) {
      missing.push(field);
      continue;
    }

    const single = CharacterDraftSchema.safeParse({ [field]: source[field] });
    if (single.success) kept[field] = source[field];
    else missing.push(field);
  }

  // Rien de garde n'est pas une proposition partielle : c'est un formulaire
  // vide, et le joueur n'a pas cause douze fois pour le remplir a la main.
  if (Object.keys(kept).length === 0) {
    return {
      kind: 'rejected',
      reason: cut ? 'truncated' : 'empty',
      details: `aucun champ retenu sur ${FIELDS.length}`,
      attempts,
      usages,
    };
  }

  return {
    kind: 'ok',
    character: CharacterDraftSchema.parse(kept),
    missing,
    usages,
  };
}
