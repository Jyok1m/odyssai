import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { UiLocale } from '@odyssai/schemas';
import { normalizeQuestion, questionHash } from './normalize.js';

const FaqEntrySchema = z.object({
  id: z.string().min(1),
  /** Plusieurs formulations de la meme question, toutes indexees. */
  questions: z.array(z.string().min(1)).min(1),
  answer: z.string().min(1),
  suggested: z.boolean(),
  /**
   * Seules les entrees relues et validees a la main sont servies. Une reponse
   * generee par le modele n'atterrit jamais ici : mettre en cache une sortie du
   * LLM permettrait a un visiteur d'empoisonner ce que voient les autres.
   */
  validated: z.boolean(),
});

export type FaqEntry = z.infer<typeof FaqEntrySchema>;

const FaqFileSchema = z.array(FaqEntrySchema);

export interface FaqIndex {
  /** Entrees validees, indexees par empreinte de question normalisee. */
  byHash: Map<string, FaqEntry>;
  /** Entrees validees et suggerees, dans l'ordre du fichier. */
  suggestions: { id: string; question: string }[];
}

/** Les fichiers vivent a la racine du paquet, hors de `src`. */
function defaultFaqDir(): string {
  return join(__dirname, '..', '..', 'faq');
}

export function loadFaq(locale: UiLocale, dir: string = defaultFaqDir()): FaqIndex {
  const raw: unknown = JSON.parse(
    readFileSync(join(dir, `guide.${locale}.json`), 'utf8'),
  );
  const entries = FaqFileSchema.parse(raw);

  const byHash = new Map<string, FaqEntry>();
  const seen = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.validated) continue;

    for (const question of entry.questions) {
      const normalized = normalizeQuestion(question);
      const owner = seen.get(normalized);

      // Deux entrees qui repondent a la meme question rendraient le resultat
      // dependant de l'ordre du fichier : on refuse de charger.
      if (owner && owner !== entry.id) {
        throw new Error(
          `FAQ ${locale} : la question « ${question} » est portee par ${owner} et ${entry.id}`,
        );
      }

      seen.set(normalized, entry.id);
      byHash.set(questionHash(locale, question), entry);
    }
  }

  const suggestions = entries
    .filter((entry) => entry.validated && entry.suggested)
    .map((entry) => ({ id: entry.id, question: entry.questions[0]! }));

  return { byHash, suggestions };
}

export function findFaqAnswer(
  index: FaqIndex,
  locale: UiLocale,
  question: string,
): FaqEntry | undefined {
  return index.byHash.get(questionHash(locale, question));
}
