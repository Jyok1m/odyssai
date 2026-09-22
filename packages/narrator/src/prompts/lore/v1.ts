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

  v2 : le fragment est realiste. La v1 laissait ecrire qu'une cuisiniere
  « transformait sa chaleur interne en plats nourrissants » : une personne a
  un metier, un objet a une provenance, jamais une aura.
*/
const INSTRUCTIONS: Record<UiLocale, string> = {
  fr: `Tu écris ce que le monde sait d'une chose que le meneur vient de poser en jeu : une personne, un objet, un lieu ou une faction.

Réponds uniquement par un objet JSON, sans texte autour, sans balise de code :
{"known":"...","hidden":"..."}

- known : ce qu'on en dirait au marché, deux ou trois phrases. D'où ça vient, ce que ça fait, qui la paie, la craint ou s'en sert. C'est ce que le joueur apprendra en demandant.
- hidden : ce que personne ne dit, deux ou trois phrases. Un acte passé, une dette, un mensonge tenu, un lien avec une faction ou avec l'histoire en cours. Un fait concret que le jeu pourra révéler, jamais une vague menace.

Réalisme, quel que soit le monde :
- Une personne a un métier, un passé, des gens à qui elle doit quelque chose. Elle n'a pas de « pouvoir de réunir », elle ne « transforme » rien par sa seule présence : si elle sait faire une chose rare, tu dis laquelle, ce que ça coûte et qui le lui a appris.
- Un objet a une provenance, un propriétaire, une utilité, une valeur. Pas une aura.
- Un lieu a une fonction, des gens qui y passent, quelqu'un qui le tient.
- Une faction a une ressource, un chef, des ennemis.
- Une idée n'est jamais un mécanisme. Si la charte autorise une magie ou une technologie, tu en respectes les règles et le prix ; tu n'en inventes pas une autre.

Le fragment tient avec le monde : sa charte, son lore, ses factions, et les noms déjà posés, que tu peux citer mais que tu ne contredis pas. Il sert l'acte en cours quand il y en a un, sans le résoudre.

Le ton de la charte commande : dans un monde chaleureux, un secret peut être une dette d'amitié ou une honte tendre, pas forcément un crime.

N'invente aucun nom propre nouveau : ce que tu écris parle de cette entité, des noms déjà posés et du monde. Pas de Markdown.`,

  en: `You write what the world knows of something the game master has just brought into play: a person, an object, a place or a faction.

Answer with a JSON object only, no surrounding text, no code fence:
{"known":"...","hidden":"..."}

- known: what people would say of it at the market, two or three sentences. Where it comes from, what it does, who pays for it, fears it or uses it. This is what the player will learn by asking.
- hidden: what nobody says, two or three sentences. A past deed, a debt, a lie kept up, a tie to a faction or to the story under way. A concrete fact the game can reveal, never a vague threat.

Realism, whatever the world:
- A person has a trade, a past, people they owe something to. They have no "power to bring people together", they "transform" nothing by their mere presence: if they can do something rare, you say what, what it costs and who taught them.
- An object has an origin, an owner, a use, a value. Not an aura.
- A place has a function, people passing through, someone who runs it.
- A faction has a resource, a leader, enemies.
- An idea is never a mechanism. If the charter allows magic or a technology, you follow its rules and its price; you do not invent another.

The fragment holds with the world: its charter, its lore, its factions, and the names already set, which you may cite but never contradict. It serves the current act when there is one, without resolving it.

The charter's tone commands: in a warm world, a secret can be a debt of friendship or a tender shame, not necessarily a crime.

Invent no new proper name: what you write speaks of this entity, of the names already set, and of the world. No Markdown.`,
};

export const LORE_PROMPT = {
  id: 'lore/v2',

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
