import { z } from 'zod';
import {
  ArrivalSchema,
  AttributesSchema,
  CHARACTER_NAME_MAX,
  OnboardingStepSchema,
  TRAITS_MAX,
} from './onboarding.js';

/*
  Ce qu'un personnage emporte en franchissant une faille, et ce qu'il laisse.

  Le nom, le caractere et le socle chiffre traversent : c'est l'essence. Le
  metier, les talents, les objets, la reputation et l'etat appartiennent au
  monde qu'on quitte : c'est l'incarnation. Un personnage qui s'est endurci
  arrive endurci, mais il n'arrive pas avec l'epee d'un autre monde.

  Le socle est recopie sur l'essence au moment du depart, et a ce moment-la
  seulement : une synchronisation continue ferait deux verites qui se
  poursuivent.
*/

/*
  Ce qu'on rapporte d'un monde.

  Pas une epee : une cicatrice, une peur, une conviction. Ce qu'on vit
  ailleurs change qui est le personnage, pas ce qu'il possede, et c'est ce qui
  garde chaque monde equilibre : un objet trouve la-bas ne vient pas peser
  ici.

  Elle vit sur l'essence et non sur l'incarnation, parce que c'est justement
  ce qui traverse.
*/
export const MARK_KINDS = ['cicatrice', 'peur', 'conviction'] as const;
export const MarkKindSchema = z.enum(MARK_KINDS);
export type MarkKind = z.infer<typeof MarkKindSchema>;

/*
  Au dela, la fiche devient une liste et chaque marque cesse de se lire. Un
  personnage marque six fois a deja une histoire.
*/
export const MARKS_MAX = 6;

export const MarkSchema = z.object({
  kind: MarkKindSchema,
  // Le monde qui l'a laissee, tel qu'il s'appelait alors.
  world: z.string().trim().min(1).max(80),
  // Une ligne, jamais un paragraphe : c'est une trace, pas un recit.
  text: z.string().trim().min(3).max(140),
  at: z.iso.datetime(),
});

export type Mark = z.infer<typeof MarkSchema>;

export const MarksSchema = z.array(MarkSchema).max(MARKS_MAX);

/*
  Un monde ou cette essence s'est posee. `world` est nul tant que le monde
  n'est pas genere : l'histoire existe, elle n'a pas encore de nom.
*/
export const IncarnationSchema = z.object({
  universeId: z.uuid(),
  world: z.string().nullable(),
  step: OnboardingStepSchema.exclude(['username']),
  arrival: ArrivalSchema,
  accentHue: z.number().int().nullable(),
  // Vrai pour l'histoire ouverte : c'est celle qu'on est en train de jouer.
  current: z.boolean(),
});

export type Incarnation = z.infer<typeof IncarnationSchema>;

// Un personnage du joueur, et les mondes ou on le retrouve.
export const TravellerSchema = z.object({
  id: z.uuid(),
  name: z.string().max(CHARACTER_NAME_MAX),
  gender: z.string(),
  age: z.number().int(),
  traits: z.array(z.string()).max(TRAITS_MAX),
  summary: z.string(),
  attributes: AttributesSchema,
  marks: MarksSchema,
  incarnations: z.array(IncarnationSchema),
});

export type Traveller = z.infer<typeof TravellerSchema>;

export const TravellersSchema = z.object({
  travellers: z.array(TravellerSchema),
});

export type Travellers = z.infer<typeof TravellersSchema>;
