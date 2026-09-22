import { z } from 'zod';

export const CONTACT_NAME_MAX = 80;
export const CONTACT_SUBJECT_MAX = 120;
export const CONTACT_MESSAGE_MAX = 4000;

/*
  Ce qu'un visiteur envoie.

  Le nom est facultatif : exiger une identite pour signaler un bug n'apporte
  rien. L'adresse, elle, est requise, faute de quoi il n'y a pas de reponse
  possible et le message ne vaut qu'a moitie.
*/
export const ContactRequestSchema = z.object({
  name: z.string().trim().max(CONTACT_NAME_MAX).optional(),
  email: z.email().max(254),
  subject: z.string().trim().min(3).max(CONTACT_SUBJECT_MAX),
  message: z.string().trim().min(20).max(CONTACT_MESSAGE_MAX),
});

export type ContactRequest = z.infer<typeof ContactRequestSchema>;

// Un message, tel que le tableau de bord le lit.
export const ContactMessageSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  email: z.email(),
  subject: z.string(),
  message: z.string(),
  // Faux quand l'envoi du courriel a echoue : le message reste lisible ici.
  delivered: z.boolean(),
  handledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type ContactMessage = z.infer<typeof ContactMessageSchema>;

export const ContactPageSchema = z.object({
  messages: z.array(ContactMessageSchema),
  // Curseur d'la page suivante, nul quand il n'y en a plus.
  nextCursor: z.string().nullable(),
  // Ce qui reste a traiter, pour la pastille du menu.
  pending: z.number().int().nonnegative(),
});

export type ContactPage = z.infer<typeof ContactPageSchema>;
