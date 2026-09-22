import { OpenAI } from 'openai';
import type { Client } from 'langsmith';
import { wrapOpenAI } from 'langsmith/wrappers/openai';
import { LlmError, isRetryableStatus } from './errors.js';
import { LLM_PROVIDERS, type LlmProvider } from './providers.js';

export interface LlmTracing {
  // Client LangSmith construit par l'api, avec apiUrl et apiKey explicites.
  client: Client;
  projectName: string;
  // Part des appels tracee, entre 0 et 1.
  sampleRate: number;
}

export interface CreateLlmClientOptions {
  provider: LlmProvider;
  apiKey: string;
  tracing?: LlmTracing;
  // Injecte par les tests, pour qu'aucun appel ne sorte vraiment.
  fetch?: typeof globalThis.fetch;
}

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
  /*
    Appele avec la decision d'echantillonnage, avant l'appel. Le journal doit
    savoir si la requete est tracee pour qu'on retrouve la trace par sa
    metadonnee, et la decision se prend ici.
  */
  onTraced?: (traced: boolean) => void;
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
  flushTraces(): Promise<void>;
}

/*
  `apiKey`, `baseURL`, `organization` et `project` sont passes explicitement,
  y compris a null : sinon le SDK lit OPENAI_* dans l'environnement, et avec
  le fournisseur openrouter sans cle, la cle OpenAI partirait chez OpenRouter.
*/
export function createLlmClient(options: CreateLlmClientOptions): LlmClient {
  const { provider, apiKey, tracing } = options;

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

  // L'instance tracee n'existe que si l'api a decide d'activer le tracing.
  // `tracingEnabled` prime sur LANGSMITH_TRACING, verifie dans les typings.
  const traced = tracing
    ? wrapOpenAI(raw, {
        client: tracing.client,
        project_name: tracing.projectName,
        tracingEnabled: true,
      })
    : undefined;

  return {
    provider,
    baseUrl: spec.baseUrl,

    /*
      Les embeddings ne sont ni diffuses ni traces : ce n'est pas une
      generation, il n'y a rien a lire au fil de l'eau et rien a relire dans
      LangSmith. L'ordre des vecteurs suit celui des entrees, et le
      fournisseur peut le rendre desordonne : on trie sur `index`.
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

      // Jamais presence_penalty ni frequency_penalty : combines a un effort de
      // raisonnement a none, ils font remonter des 500.
      delete body.presence_penalty;
      delete body.frequency_penalty;

      const useTraced =
        traced !== undefined &&
        tracing !== undefined &&
        Math.random() < tracing.sampleRate;
      request.onTraced?.(useTraced);

      let stream: AsyncIterable<OpenAI.ChatCompletionChunk>;
      try {
        stream = useTraced
          ? await traced!.chat.completions.create(
              body as unknown as OpenAI.ChatCompletionCreateParamsStreaming,
              {
                signal: request.signal,
                langsmithExtra: request.trace,
              },
            )
          : await raw.chat.completions.create(
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

    async flushTraces(): Promise<void> {
      await tracing?.client.awaitPendingTraceBatches?.();
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
