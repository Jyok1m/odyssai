import type {
  EntityKind,
  UiLocale,
  WorldCharter,
  WorldLore,
} from '@odyssai/schemas';
import type { PromptMessage } from '../guide/v1.js';

export interface LoreContext {
  charter: WorldCharter;
  lore: WorldLore;
  factions: string[];
  // Les noms deja poses, pour ne pas en inventer un qui les contredise.
  existing: string[];
  // Le but de l'acte en cours, s'il y en a un : le lore le sert.
  goal?: string;
  entity: { name: string; kind: EntityKind; hint: string };
}

/*
  Le fragment de lore d'une entite nouvelle, en deux parts. Ecrit en francais
  accentue comme les autres prompts : c'est du texte que le modele lit.
*/
const INSTRUCTIONS: Record<UiLocale, string> = {
  fr: `Tu écris ce que le monde sait d'une chose que le meneur vient de poser en jeu : une personne, un objet, un lieu ou une faction.

Réponds uniquement par un objet JSON, sans texte autour, sans balise de code :
{"known":"...","hidden":"..."}

- known : ce qui se sait ou se voit, deux ou trois phrases. D'où ça vient, à quoi ça sert, qui s'en soucie. C'est ce que le joueur apprendra en demandant.
- hidden : ce que personne ne dit, deux ou trois phrases. Un passé, une dette, une faille, un lien avec une faction ou avec l'histoire en cours. Un fait concret que le jeu pourra révéler, jamais une vague menace.

Le fragment tient avec le monde : sa charte, son lore, ses factions, et les noms déjà posés, que tu peux citer mais que tu ne contredis pas. Il sert l'acte en cours quand il y en a un, sans le résoudre.

Le ton de la charte commande : dans un monde chaleureux, un secret peut être une dette d'amitié ou une honte tendre, pas forcément un crime.

N'invente aucun nom propre nouveau : ce que tu écris parle de cette entité, des noms déjà posés et du monde. Pas de Markdown.`,

  en: `You write what the world knows of something the game master has just brought into play: a person, an object, a place or a faction.

Answer with a JSON object only, no surrounding text, no code fence:
{"known":"...","hidden":"..."}

- known: what is known or seen, two or three sentences. Where it comes from, what it is for, who cares about it. This is what the player will learn by asking.
- hidden: what nobody says, two or three sentences. A past, a debt, a flaw, a tie to a faction or to the story under way. A concrete fact the game can reveal, never a vague threat.

The fragment holds with the world: its charter, its lore, its factions, and the names already set, which you may cite but never contradict. It serves the current act when there is one, without resolving it.

The charter's tone commands: in a warm world, a secret can be a debt of friendship or a tender shame, not necessarily a crime.

Invent no new proper name: what you write speaks of this entity, of the names already set, and of the world. No Markdown.`,
};

export const LORE_PROMPT = {
  id: 'lore/v1',

  build(locale: UiLocale, context: LoreContext): PromptMessage[] {
    const world = [
      `<charte>\n${JSON.stringify(context.charter, null, 2)}\n</charte>`,
      `<monde>\n${JSON.stringify(
        {
          era: context.lore.era,
          geography: context.lore.geography,
          dailyLife: context.lore.dailyLife,
          factions: context.factions,
        },
        null,
        2,
      )}\n</monde>`,
      context.existing.length > 0
        ? `<noms_poses>\n${context.existing.join('\n')}\n</noms_poses>`
        : '',
      context.goal ? `<acte>\n${context.goal}\n</acte>` : '',
      `<entite>\n${JSON.stringify(context.entity, null, 2)}\n</entite>`,
    ]
      .filter(Boolean)
      .join('\n\n');

    return [
      { role: 'system', content: INSTRUCTIONS[locale] },
      { role: 'user', content: world },
    ];
  },
} as const;
