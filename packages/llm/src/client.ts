import { OpenAI } from 'openai';
import { LlmError, isRetryableStatus } from './errors.js';
import { LLM_PROVIDERS, type LlmProvider } from './providers.js';

export interface CreateLlmClientOptions {
  provider: LlmProvider;
  apiKey: string;
  // Injecte par les tests, pour qu'aucun appel ne sorte vraiment.
  fetch?: typeof globalThis.fetch;
}

/*
  De quoi retrouver un appel dans l'observabilite.

  Ce n'est plus le SDK LangSmith qui l'emporte mais OpenRouter, par son champ
  de corps `trace` : c'est lui qui diffuse vers la destination configuree, et
  lui seul connait le cout reel et le fournisseur vers lequel il a route.

  Consequence a connaitre : sans ces metadonnees dans le corps, la trace
  arriverait orpheline. C'est par elles qu'on rejoint `llm_usage`, `turns` et
  `guide_questions`, jamais par un identifiant rendu par la passerelle.
*/
export interface LlmTrace {
  name: string;
  metadata: Record<string, unknown>;
  tags?: string[];
}

export interface StreamChatRequest {
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  maxOutputTokens: number;
  temperature: number;
  extraBody?: Record<string, unknown>;
  signal?: AbortSignal;
  trace?: LlmTrace;
}

export type LlmStreamEvent =
  | { type: 'text'; text: string }
  | {
      type: 'usage';
      model: string;
      inputTokens: number;
      outputTokens: number;
      reasoningTokens?: number;
      costUsd?: number;
    };

/*
  Un lot d'embeddings. Les textes partent ensemble : le fournisseur facture au
  token, pas a l'appel, et un aller-retour par phrase multiplierait la latence
  sans rien economiser.
*/
export interface EmbedRequest {
  model: string;
  inputs: string[];
  signal?: AbortSignal;
}

export interface EmbedResult {
  // Un vecteur par entree, dans le meme ordre.
  vectors: number[][];
  model: string;
  inputTokens: number;
}

export interface LlmClient {
  readonly provider: LlmProvider;
  // URL du registre reellement utilisee, pour verification et journalisation.
  readonly baseUrl: string;
  streamChat(request: StreamChatRequest): AsyncIterable<LlmStreamEvent>;
  embed(request: EmbedRequest): Promise<EmbedResult>;
}

/*
  `apiKey`, `baseURL`, `organization` et `project` sont passes explicitement,
  y compris a null : sinon le SDK lit OPENAI_* dans l'environnement, et avec
  le fournisseur openrouter sans cle, la cle OpenAI partirait chez OpenRouter.
*/
export function createLlmClient(options: CreateLlmClientOptions): LlmClient {
  const { provider, apiKey } = options;

  if (!apiKey) {
    throw new LlmError(`cle absente pour le fournisseur ${provider}`, {
      retryable: false,
    });
  }

  const spec = LLM_PROVIDERS[provider];
  const raw = new OpenAI({
    apiKey,
    baseURL: spec.baseUrl,
    organization: null,
    project: null,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  return {
    provider,
    baseUrl: spec.baseUrl,

    /*
      Les embeddings ne sont pas diffuses : il n'y a rien a lire au fil de
      l'eau. L'ordre des vecteurs suit celui des entrees, et le fournisseur
      peut le rendre desordonne : on trie sur `index`.
    */
    async embed(request: EmbedRequest): Promise<EmbedResult> {
      const response = await raw.embeddings.create(
        { model: request.model, input: request.inputs },
        { signal: request.signal },
      );

      const ordered = [...response.data].sort((a, b) => a.index - b.index);

      return {
        vectors: ordered.map((item) => item.embedding),
        model: response.model || request.model,
        inputTokens: response.usage?.prompt_tokens ?? 0,
      };
    },

    async *streamChat(request: StreamChatRequest): AsyncIterable<LlmStreamEvent> {
      const body: Record<string, unknown> = {
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        stream: true,
        // Sans quoi le dernier chunk ne porte pas l'usage, et le budget se
        // reglerait sur l'estimation au lieu du cout reel.
        stream_options: { include_usage: true },
        [spec.maxOutputTokensParam]: request.maxOutputTokens,
        ...request.extraBody,
      };

      /*
        Champ propre a OpenRouter : l'API d'OpenAI rejette ce qu'elle ne
        connait pas, comme pour les cles de `OPENROUTER_ONLY_BODY_KEYS`.
      */
      if (provider === 'openrouter' && request.trace) {
        body.trace = {
          trace_name: request.trace.name,
          ...request.trace.metadata,
          ...(request.trace.tags ? { tags: request.trace.tags } : {}),
        };
      }

      // Jamais presence_penalty ni frequency_penalty : combines a un effort de
      // raisonnement a none, ils font remonter des 500.
      delete body.presence_penalty;
      delete body.frequency_penalty;

      let stream: AsyncIterable<OpenAI.ChatCompletionChunk>;
      try {
        stream = await raw.chat.completions.create(
          body as unknown as OpenAI.ChatCompletionCreateParamsStreaming,
          { signal: request.signal },
        );
      } catch (error: unknown) {
        throw toLlmError(error);
      }

      try {
        for await (const chunk of stream) {
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) yield { type: 'text', text };

          const usage = chunk.usage as UsageChunk | null | undefined;
          if (usage) {
            yield {
              type: 'usage',
              model: chunk.model || request.model,
              inputTokens: usage.prompt_tokens ?? 0,
              outputTokens: usage.completion_tokens ?? 0,
              reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
              // OpenRouter rend le cout reel, les autres non.
              costUsd: typeof usage.cost === 'number' ? usage.cost : undefined,
            };
          }
        }
      } catch (error: unknown) {
        throw toLlmError(error);
      }
    },
  };
}

// Usage tel qu'il arrive vraiment, extensions de fournisseur comprises.
interface UsageChunk {
  prompt_tokens?: number;
  completion_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
  cost?: number;
}

function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;

  if (error instanceof OpenAI.APIError) {
    // Le message du fournisseur peut renvoyer une partie de la requete :
    // seuls le statut et le type d'erreur sortent d'ici.
    return new LlmError(`appel refuse par le fournisseur (HTTP ${error.status})`, {
      status: error.status,
      retryable: isRetryableStatus(error.status),
    });
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return new LlmError('appel interrompu', { retryable: false });
  }

  return new LlmError('appel au fournisseur en echec', { retryable: true });
}
