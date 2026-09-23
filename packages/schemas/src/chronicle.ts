import { z } from 'zod';
import { EntityKindSchema } from './world.js';

/*
  La chronique des voyageurs : ce que les visites ont laisse dans un monde, et
  que son createur valide ou refuse.

  C'est le seul chemin par lequel une visite atteint le monde de l'hote. Elle
  ecrit chez elle, toujours ; ce qu'elle propose ne devient vrai ici que
  lorsque celui a qui ce monde appartient le decide. La regle « un univers
  n'ecrit jamais dans l'etat d'un autre » tient donc jusqu'au bout : c'est
  l'hote qui ecrit, dans son monde, ce qu'il a lu.

  Ce qui se valide, ce sont les faits entres au canon et les entites nees
  pendant la visite : la matiere du monde. Les tours du visiteur, eux, sont sa
  partie a lui et le restent.
*/
export const CHRONICLE_DECISIONS_MAX = 50;

export const ChronicleEntryKindSchema = z.enum(['fact', 'entity']);
export type ChronicleEntryKind = z.infer<typeof ChronicleEntryKindSchema>;

export const ChronicleEntrySchema = z.object({
  id: z.uuid(),
  kind: ChronicleEntryKindSchema,
  // De quoi il s'agit : un sujet pour un fait, un nom pour une entite.
  subject: z.string(),
  // Ce que ca dit. Le su seulement pour une entite : le cache reste au meneur.
  statement: z.string(),
  // Present pour une entite seulement.
  entity: EntityKindSchema.nullable(),
});

export type ChronicleEntry = z.infer<typeof ChronicleEntrySchema>;

/*
  Une visite recue, et ce qu'elle laisse a relire.

  Le pseudo du visiteur y figure : c'est ce pour quoi il existe. Le nom de son
  personnage aussi, parce que c'est lui qu'on a croise, pas un compte.
*/
export const ChronicleVisitSchema = z.object({
  visitId: z.uuid(),
  visitor: z.string().nullable(),
  character: z.string().nullable(),
  turns: z.number().int().nonnegative(),
  at: z.iso.datetime(),
  entries: z.array(ChronicleEntrySchema),
});

export type ChronicleVisit = z.infer<typeof ChronicleVisitSchema>;

export const ChronicleSchema = z.object({
  visits: z.array(ChronicleVisitSchema),
});

export type Chronicle = z.infer<typeof ChronicleSchema>;

/*
  Ce que l'hote decide. Plusieurs d'un coup : relire cinq faits ne doit pas
  demander cinq allers-retours, et il les lit ensemble de toute facon.
*/
export const ChronicleDecisionsSchema = z.object({
  decisions: z
    .array(
      z.object({
        id: z.uuid(),
        kind: ChronicleEntryKindSchema,
        accept: z.boolean(),
      }),
    )
    .min(1)
    .max(CHRONICLE_DECISIONS_MAX),
});

export type ChronicleDecisions = z.infer<typeof ChronicleDecisionsSchema>;
