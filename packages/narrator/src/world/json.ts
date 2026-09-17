import type { LlmClient, LlmTrace } from '@odyssai/llm';
import type { PromptMessage } from '../prompts/guide/v1.js';

export interface JsonModelConfig {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  extraBody?: Record<string, unknown>;
}

export interface JsonUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/**
 * Certains modeles enrobent leur JSON dans une balise de code malgre la
 * consigne. Le refuser pour cela seul couterait une relance pour rien.
 */
export function unwrapJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? raw).trim();
}

export interface JsonCallRequest {
  llm: LlmClient;
  config: JsonModelConfig;
  messages: PromptMessage[];
  signal?: AbortSignal;
  trace?: LlmTrace;
}

export type JsonCallResult =
  | { kind: 'ok'; value: unknown; usage: JsonUsage }
  | { kind: 'invalid_json'; raw: string; usage: JsonUsage };

/** Un appel qui rend du JSON. Le texte est accumule, jamais diffuse. */
export async function callJson(
  request: JsonCallRequest,
): Promise<JsonCallResult> {
  const { llm, config, messages, signal, trace } = request;

  let text = '';
  const usage: JsonUsage = {};

  for await (const event of llm.streamChat({
    model: config.model,
    messages,
    maxOutputTokens: config.maxOutputTokens,
    temperature: config.temperature,
    extraBody: config.extraBody,
    signal,
    trace,
  })) {
    if (event.type === 'text') text += event.text;
    if (event.type === 'usage') {
      usage.model = event.model;
      usage.inputTokens = event.inputTokens;
      usage.outputTokens = event.outputTokens;
      usage.costUsd = event.costUsd;
    }
  }

  try {
    return { kind: 'ok', value: JSON.parse(unwrapJson(text)), usage };
  } catch {
    return { kind: 'invalid_json', raw: text, usage };
  }
}
