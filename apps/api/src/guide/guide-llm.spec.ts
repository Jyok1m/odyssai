import { describe, expect, it, vi } from 'vitest';
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

  /*
    Le rattachement ne passe plus par le SDK mais par le corps de la requete :
    c'est OpenRouter qui diffuse, et sans ces metadonnees la trace arriverait
    orpheline, impossible a relier a un tour ou a une ligne de `llm_usage`.
  */
  describe('metadonnees de trace', () => {
    const TRACE = {
      name: 'turn',
      metadata: { turn_id: 't-1', universe_id: 'u-1' },
      tags: ['jeu'],
    };

    const drain = async (
      provider: 'openrouter' | 'openai',
      trace?: typeof TRACE,
    ) => {
      const fetchSpy = fakeFetch();
      const client = createLlmClient({
        provider,
        apiKey: 'sk-x',
        fetch: fetchSpy as unknown as typeof fetch,
      });

      for await (const _ of client.streamChat({ ...REQUEST, trace })) {
        // on epuise le flux
      }
      return bodyOf(fetchSpy);
    };

    it('pose le champ trace chez OpenRouter', async () => {
      expect((await drain('openrouter', TRACE)).trace).toEqual({
        trace_name: 'turn',
        turn_id: 't-1',
        universe_id: 'u-1',
        tags: ['jeu'],
      });
    });

    // L'API d'OpenAI rejette les arguments qu'elle ne connait pas.
    it('ne le pose pas chez OpenAI en direct', async () => {
      expect((await drain('openai', TRACE)).trace).toBeUndefined();
    });

    it('ne pose rien quand l appelant ne trace pas', async () => {
      expect((await drain('openrouter')).trace).toBeUndefined();
    });
  });
});
