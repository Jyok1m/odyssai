import type { LlmClient, LlmStreamEvent, StreamChatRequest } from '@odyssai/llm';
import type { FaqEntry } from '@odyssai/narrator';
import { FakeRedis } from '../../auth/testing/doubles.js';
import { ACQUIRE_SLOT, INCREMENT_WINDOWS } from '../guide-limits.service.js';
import { RESERVE_BUDGET, SETTLE_BUDGET } from '../guide-budget.service.js';
import { CONSUME_PASS } from '../guide-pass.service.js';

/*
  Redis du guide. Les scripts sont reconnus par identite plutot que rejoues :
  le double doit rendre le meme resultat que Lua, pas l'interpreter.
*/
export class GuideFakeRedis extends FakeRedis {
  private readonly zsets = new Map<string, Map<string, number>>();

  override async eval(
    script: string,
    numKeys: number,
    ...args: unknown[]
  ): Promise<unknown> {
    const keys = args.slice(0, numKeys).map(String);
    const argv = args.slice(numKeys).map(String);

    if (script === INCREMENT_WINDOWS) {
      const hour = this.bump(keys[0]!, Number(argv[0]));
      const day = this.bump(keys[1]!, Number(argv[1]));
      return [hour, day, Number(argv[0]), Number(argv[1])];
    }

    if (script === ACQUIRE_SLOT) {
      const set = this.zset(keys[0]!);
      for (const [member, score] of set) {
        if (score <= Number(argv[0])) set.delete(member);
      }
      if (set.size >= Number(argv[1])) return 0;
      set.set(argv[3]!, Number(argv[2]));
      return 1;
    }

    if (script === RESERVE_BUDGET) {
      const spent = Number(this.live(keys[0]!) ?? '0');
      const reserved = Number(this.live(keys[1]!) ?? '0');
      const estimate = Number(argv[0]);
      if (spent + reserved + estimate > Number(argv[1])) return 0;
      await this.set(keys[1]!, String(reserved + estimate));
      this.reservations.set(`${keys[2]}:${argv[2]}`, estimate);
      return 1;
    }

    if (script === SETTLE_BUDGET) {
      const handle = `${keys[2]}:${argv[0]}`;
      const reserved = this.reservations.get(handle);
      if (reserved !== undefined) {
        const current = Number(this.live(keys[1]!) ?? '0');
        await this.set(keys[1]!, String(current - reserved));
        this.reservations.delete(handle);
      }
      const real = argv[1] === '' ? (reserved ?? 0) : Number(argv[1]);
      await this.set(keys[0]!, String(Number(this.live(keys[0]!) ?? '0') + real));
      return String(real);
    }

    if (script === CONSUME_PASS) {
      const left = Number(this.live(keys[0]!) ?? '-1');
      if (left < 1) return -1;
      await this.set(keys[0]!, String(left - 1));
      return left - 1;
    }

    return super.eval(script, numKeys, ...keys, ...argv);
  }

  async zrem(key: string, member: string): Promise<number> {
    return this.zset(key).delete(member) ? 1 : 0;
  }

  inflight(key = 'guide:inflight'): number {
    return this.zset(key).size;
  }

  private readonly reservations = new Map<string, number>();

  private zset(key: string): Map<string, number> {
    let set = this.zsets.get(key);
    if (!set) {
      set = new Map();
      this.zsets.set(key, set);
    }
    return set;
  }

  private bump(key: string, ttlSeconds: number): number {
    const next = Number(this.live(key) ?? '0') + 1;
    this.store.set(key, {
      value: String(next),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return next;
  }
}

export interface FakeLlmOptions {
  chunks?: string[];
  /*
    Un lot par appel, pour voir un rejeu rendre autre chose que le premier
    essai. Au dela du dernier lot, le dernier se repete.
  */
  replies?: string[][];
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
  fail?: boolean;
  /*
    Les appels qui echouent, numerotes a partir de un dans l'ordre ou ils
    partent : de quoi faire tomber un role et pas les autres, la moderation
    passant avant la conversation dans un meme message.
  */
  failCalls?: number[];
  /*
    Le flux rend ce nombre de morceaux puis casse, comme une connexion qui
    tombe en cours de phrase : ce qui est parti est parti.
  */
  cutAfter?: number;
  // De quoi echouer d'une facon precise : un refus franc, un abandon.
  failWith?: unknown;
  // Pourquoi le modele s'arrete. `length` vaut sortie coupee par le plafond.
  stop?: string;
}

export interface FakeLlm extends LlmClient {
  calls: StreamChatRequest[];
  aborted: boolean;
}

// Client LLM de test. Aucun appel ne sort, aucune trace ne part.
export function makeFakeLlm(options: FakeLlmOptions = {}): FakeLlm {
  const calls: StreamChatRequest[] = [];
  const state = { aborted: false };

  const client: FakeLlm = {
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    calls,
    get aborted() {
      return state.aborted;
    },

    /*
      Deterministe, et suffisant pour un test : deux textes identiques donnent
      le meme vecteur, deux textes differents des vecteurs differents. Aucun
      appel ne sort.
    */
    async embed({ inputs, model }: { inputs: string[]; model: string }) {
      return {
        vectors: inputs.map((text) =>
          Array.from({ length: 8 }, (_, i) =>
            [...text].reduce((sum, ch, at) => sum + ch.charCodeAt(0) * ((at % 8) + 1 === i + 1 ? 1 : 0), 0),
          ),
        ),
        model,
        inputTokens: inputs.reduce((total, text) => total + text.length, 0),
      };
    },

    async *streamChat(request: StreamChatRequest): AsyncIterable<LlmStreamEvent> {
      calls.push(request);
      const index = calls.length - 1;
      request.signal?.addEventListener('abort', () => {
        state.aborted = true;
      });

      if (options.fail || options.failCalls?.includes(calls.length)) {
        throw options.failWith ?? new Error('fournisseur en echec');
      }

      const texts =
        options.replies?.[Math.min(index, options.replies.length - 1)] ??
        options.chunks ?? ['Une reponse de test.'];

      let sent = 0;
      for (const text of texts) {
        if (request.signal?.aborted) return;
        if (sent === options.cutAfter) throw new Error('flux rompu');
        yield { type: 'text', text };
        sent += 1;
      }

      if (options.stop) yield { type: 'stop', reason: options.stop };

      if (options.usage) {
        yield {
          type: 'usage',
          model: request.model,
          inputTokens: options.usage.inputTokens,
          outputTokens: options.usage.outputTokens,
          costUsd: options.usage.costUsd,
        };
      }
    },

  };

  return client;
}

export function makeFaqEntry(overrides: Partial<FaqEntry> = {}): FaqEntry {
  return {
    id: 'entree-test',
    questions: ['Une question de FAQ ?'],
    answer: 'Une reponse de FAQ validee.',
    suggested: true,
    validated: true,
    ...overrides,
  };
}
