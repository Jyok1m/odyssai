import { z } from 'zod';

/*
  Combien de joueurs s'asseoient a une table. Le solo n'est pas une partie :
  il commence par POST /stories comme toujours, et rien de ce fichier ne le
  concerne.
*/
export const PARTY_MIN = 2;
export const PARTY_MAX = 4;

/*
  Huit caracteres, sans ambiguite : un code se dicte a voix haute, et un O lu
  pour un zero ferait rejoindre une autre table.

  Sans accent ni casse, pour la meme raison que les cles d'enum : la valeur
  voyage dans une requete que le joueur tape.
*/
export const PARTY_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const PARTY_CODE_LENGTH = 8;

/*
  Le code tel qu'il se tape : « 2345-6789 » ou « 23456789 », casses et
  separateurs importent peu. Plier ici et non dans le service, pour que la
  validation et la comparaison lisent la meme chose.
*/
export function normalizePartyCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, PARTY_CODE_LENGTH);
}

// Ce qu'on envoie pour ouvrir une table.
export const PartyStartSchema = z.object({
  size: z.number().int().min(PARTY_MIN).max(PARTY_MAX),
});

export type PartyStart = z.infer<typeof PartyStartSchema>;

// Ce qu'on envoie pour s'y asseoir.
export const PartyJoinSchema = z.object({
  code: z.string().trim().min(1).max(20),
});

export type PartyJoin = z.infer<typeof PartyJoinSchema>;

/*
  Un siege a la table, tel que le parcours et la table l'affichent.

  `characterName` et non `username` : ce qu'on montre d'un joueur dans un jeu,
  c'est son personnage. Nul tant que la fiche n'existe pas.
*/
export const PartyMemberSchema = z.object({
  userId: z.uuid(),
  username: z.string().nullable(),
  characterName: z.string().nullable(),
  ready: z.boolean(),
  host: z.boolean(),
  mine: z.boolean(),
});

export type PartyMember = z.infer<typeof PartyMemberSchema>;

/*
  La table, son code et ses sieges. Servie telle quelle dans le parcours et
  dans le monde : une seule forme, pour que l'ecran qui attend les autres et
  celui qui joue disent la meme chose.
*/
export const PartySchema = z.object({
  id: z.uuid(),
  universeId: z.uuid(),
  size: z.number().int(),
  inviteCode: z.string(),
  members: z.array(PartyMemberSchema),
});

export type Party = z.infer<typeof PartySchema>;

// Refus des routes de partie.
export const PartyErrorBodySchema = z.object({
  code: z.enum([
    'validation_error',
    // Le code ne correspond a aucune table.
    'not_found',
    // La table est pleine.
    'party_full',
    // Le joueur siege deja a une table : on n'en ouvre pas une seconde.
    'in_party',
    // L'histoire a quitte l'inspiration : on ne la rejoint plus.
    'locked',
    // L'hote a deja autant d'histoires que la borne l'autorise.
    'stories_full',
    // La reserve de credits de ce joueur ne couvre pas sa part du monde.
    'out_of_credits',
  ]),
});

export type PartyErrorBody = z.infer<typeof PartyErrorBodySchema>;
