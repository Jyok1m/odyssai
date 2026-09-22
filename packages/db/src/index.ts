/*
  Le client est genere depuis le schema de ce paquet, celui-la meme que le CLI
  Prisma lit pour les migrations : une seule source pour l'api et le worker.

  ESM, seul paquet a l'etre : le client genere emet du `import.meta`, que
  TypeScript refuse de transpiler en CommonJS.
*/
export { PrismaClient, Prisma } from './generated/prisma/client.js';
export { createPrismaClient } from './client.js';

export type {
  User,
  GuideQuestion,
  Universe,
  Character,
  ConversationMessage,
  GenerationJob,
  Encounter,
  Turn,
  CanonFact,
  LlmUsage,
  Plan,
  Subscription,
  CreditEntry,
  StripeEvent,
  SiteSettings,
  ContactMessage,
} from './generated/prisma/client.js';

export {
  Locale,
  GuideSource,
  OnboardingStep,
  InspirationMode,
  ConversationChannel,
  MessageRole,
  GenerationStatus,
  GenerationStep,
} from './generated/prisma/enums.js';

export { loadRootEnvFile } from './env.js';
