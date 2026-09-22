import { createHash } from 'node:crypto';
import type { UiLocale } from '@odyssai/schemas';

/*
  Forme canonique d'une question, pour que « Comment ça marche ? » et
  « comment ca marche » tombent sur la meme entree de FAQ.

  L'ordre compte : decomposer avant de retirer les diacritiques, sans quoi les
  caracteres precomposes passeraient au travers.
*/
export function normalizeQuestion(question: string): string {
  return question
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Cle d'index d'une question. La locale en fait partie : les FAQ sont separees.
export function questionHash(locale: UiLocale, question: string): string {
  return createHash('sha256')
    .update(`${locale}:${normalizeQuestion(question)}`)
    .digest('hex');
}
