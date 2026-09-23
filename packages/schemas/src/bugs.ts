import { z } from 'zod';

export const BUG_MESSAGE_MIN = 10;
export const BUG_MESSAGE_MAX = 4000;
export const BUG_PAGE_MAX = 200;
export const SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;
export const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/*
  Ce qu'un joueur envoie depuis le jeu. La capture voyage a cote, en
  multipart : elle n'a rien a faire dans un JSON, et sa borne est en octets.
*/
export const BugReportRequestSchema = z.object({
  page: z.string().trim().max(BUG_PAGE_MAX),
  message: z.string().trim().min(BUG_MESSAGE_MIN).max(BUG_MESSAGE_MAX),
});

export type BugReportRequest = z.infer<typeof BugReportRequestSchema>;

// Un rapport, tel que le tableau de bord le lit. La capture se demande a part.
export const BugReportSchema = z.object({
  id: z.uuid(),
  username: z.string().nullable(),
  email: z.string().nullable(),
  page: z.string(),
  message: z.string(),
  userAgent: z.string(),
  hasScreenshot: z.boolean(),
  handledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type BugReport = z.infer<typeof BugReportSchema>;

export const BugReportPageSchema = z.object({
  reports: z.array(BugReportSchema),
  nextCursor: z.string().nullable(),
  // Ce qui reste a traiter, pour la pastille du menu.
  pending: z.number().int().nonnegative(),
});

export type BugReportPage = z.infer<typeof BugReportPageSchema>;
