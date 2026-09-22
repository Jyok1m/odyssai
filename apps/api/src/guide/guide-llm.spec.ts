import { describe, expect, it, vi } from 'vitest';
import { Client } from 'langsmith';
import { LlmError, createLlmClient } from '@odyssai/llm';

// Corps SSE minimal, pour qu'aucun appel ne sorte vraiment.
function sseResponse(): Response {
  const body = [
    'data: {"model":"m","choices":[{"delta":{"content":"bonjour"}}]}\n\n',
    'data: {"model":"m","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3,"cost":0.002}}\n\n',
    'data: [DONE]\n\n',
  ].join('');

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function fakeFetch() {
  return vi.fn(async (_url: unknown, _init?: { body?: unknown }) => sseResponse());
}

function bodyOf(spy: ReturnType<typeof fakeFetch>): Record<string, unknown> {
  return JSON.parse(String(spy.mock.calls[0]![1]!.body)) as Record<string, unknown>;
}

// Client LangSmith qui ne joint rien : le tracing ne doit jamais sortir.
function silentLangsmith(): Client {
  return new Client({
    apiUrl: 'https://langsmith.invalid',
    apiKey: 'ls-factice',
    fetchImplementation: (async () =>
      new Response('{}', { status: 200 })) as unknown as typeof fetch,
  });
}

const REQUEST = {
  model: 'modele/de-test',
  messages: [{ role: 'user' as const, content: 'bonjour' }],
  maxOutputTokens: 30,
  temperature: 0.3,
};

describe('createLlmClient', () => {
  it('refuse une cle vide meme si OPENAI_API_KEY est defini', () => {
    // Le setup de test pose une vraie forme de cle dans l'environnement :
    // c'est exactement le piege que la garde doit attraper.
    expect(process.env.OPENAI_API_KEY).toBeTruthy();

    expect(() => createLlmClient({ provider: 'openrouter', apiKey: '' })).toThrow(
      LlmError,
    );
  });

  it('prend la baseURL du registre et non celle de l environnement', () => {
    const previous = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = 'https://detournement.invalid/v1';

    try {
      expect(createLlmClient({ provider: 'openrouter', apiKey: 'sk-or-x' }).baseUrl).toBe(
        'https://openrouter.ai/api/v1',
      );
      expect(createLlmClient({ provider: 'openai', apiKey: 'sk-x' }).baseUrl).toBe(
        'https://api.openai.com/v1',
      );
    } finally {
      if (previous === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = previous;
    }
  });

  it('rend le texte puis l usage, cout du fournisseur compris', async () => {
    const client = createLlmClient({
      provider: 'openrouter',
      apiKey: 'sk-or-x',
      fetch: fakeFetch() as unknown as typeof fetch,
    });

    const events = [];
    for await (const event of client.streamChat(REQUEST)) events.push(event);

    expect(events).toEqual([
      { type: 'text', text: 'bonjour' },
      {
        type: 'usage',
        model: 'm',
        inputTokens: 10,
        outputTokens: 3,
        reasoningTokens: undefined,
        costUsd: 0.002,
      },
    ]);
  });

  it('n envoie jamais presence_penalty ni frequency_penalty', async () => {
    const fetchSpy = fakeFetch();
    const client = createLlmClient({
      provider: 'openrouter',
      apiKey: 'sk-or-x',
      fetch: fetchSpy as unknown as typeof fetch,
    });

    for await (const _ of client.streamChat({
      ...REQUEST,
      extraBody: { presence_penalty: 1, frequency_penalty: 1, models: ['secours'] },
    })) {
      // on epuise le flux
    }

    const body = bodyOf(fetchSpy);

    expect(body.presence_penalty).toBeUndefined();
    expect(body.frequency_penalty).toBeUndefined();
    expect(body.models).toEqual(['secours']);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.max_tokens).toBe(30);
  });

  it('utilise max_completion_tokens chez OpenAI en direct', async () => {
    const fetchSpy = fakeFetch();
    const client = createLlmClient({
      provider: 'openai',
      apiKey: 'sk-x',
      fetch: fetchSpy as unknown as typeof fetch,
    });

    for await (const _ of client.streamChat(REQUEST)) {
      // on epuise le flux
    }

    const body = bodyOf(fetchSpy);

    expect(body.max_completion_tokens).toBe(30);
    expect(body.max_tokens).toBeUndefined();
  });

  describe('echantillonnage', () => {
    const drain = async (sampleRate: number): Promise<boolean> => {
      let traced: boolean | undefined;
      const client = createLlmClient({
        provider: 'openrouter',
        apiKey: 'sk-or-x',
        fetch: fakeFetch() as unknown as typeof fetch,
        tracing: {
          client: silentLangsmith(),
          projectName: 'Odyssai-Test',
          sampleRate,
        },
      });

      for await (const _ of client.streamChat({
        ...REQUEST,
        onTraced: (value) => {
          traced = value;
        },
      })) {
        // on epuise le flux
      }
      return traced!;
    };

    it('sampleRate 0 passe toujours par l instance brute', async () => {
      expect(await drain(0)).toBe(false);
    });

    it('sampleRate 1 passe toujours par l instance tracee', async () => {
      expect(await drain(1)).toBe(true);
    });
  });
});
