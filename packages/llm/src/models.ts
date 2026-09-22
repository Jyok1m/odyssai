/*
  Les modeles, par role, codes en dur.

  Une seule variable servait six roles qui n'ont pas les memes besoins : le
  tour veut de la prose et un bloc JSON en queue, la generation veut de la
  creativite sept fois par monde, l'extraction veut un JSON strict et rien
  d'autre. Choisir un modele pour tous obligeait a un compromis entre la
  prose du meneur et la rigueur de l'extraction.

  En code et non dans l'environnement : un changement de modele est une
  decision de produit qui se relit dans l'historique, pas un reglage de
  machine. `LLM_NARRATOR_CANDIDATES` reste en variable pour l'evaluation, qui
  compare avant qu'on decide ici.

  Les prix de repli `LLM_NARRATOR_PRICE_*` ne connaissent qu'un bareme : ils
  ne servent que si OpenRouter cesse de rendre le cout, et ils seront faux
  pour les roles qui ne tournent pas sur le modele du tour.
*/
export type LlmRole =
  | 'turn'
  | 'dialogue'
  | 'generation'
  | 'lore'
  | 'character'
  | 'extract'
  | 'abstraction';

export interface LlmModelSpec {
  model: string;
  temperature: number;
  maxOutputTokens: number;
}

export const LLM_MODELS: Record<LlmRole, LlmModelSpec> = {
  // La prose, le ton, le francais, et le bloc de queue. Le seul role ou la
  // qualite se voit a chaque tour : un dense, pas un MoE a trois milliards
  // actifs.
  turn: { model: 'qwen/qwen3.8-27b', temperature: 0.85, maxOutputTokens: 900 },

  /*
    La replique d'un personnage, quand le joueur s'adresse a lui. Un modele
    de jeu de role, pas un assistant : il tient une voix, refuse, ment, et ne
    lisse pas. Une a trois phrases, que le meneur reprend telles quelles.
  */
  dialogue: { model: 'gryphe/mythomax-l2-13b', temperature: 0.9, maxOutputTokens: 160 },

  // Sept appels par monde, amortis sur vingt-cinq credits : la qualite y est
  // presque gratuite, et c'est elle qui decide de la coherence de tout ce qui
  // suit.
  generation: { model: 'qwen/qwen3.7-plus', temperature: 0.8, maxOutputTokens: 1400 },

  // Rare, court, et tout tient a la coherence avec ce qui est deja pose.
  lore: { model: 'qwen/qwen3.7-plus', temperature: 0.7, maxOutputTokens: 400 },

  // Un dialogue de trois phrases, dix fois par partie : discipline, pas prose.
  character: { model: 'qwen/qwen3.5-9b', temperature: 0.6, maxOutputTokens: 300 },

  // Un JSON strict, une fois par partie. La temperature basse est le point.
  extract: { model: 'qwen/qwen3.5-9b', temperature: 0.2, maxOutputTokens: 500 },

  // Des themes sans nom propre, une fois par partie, relus par le schema.
  abstraction: { model: 'qwen/qwen3.5-9b', temperature: 0.3, maxOutputTokens: 700 },
};
