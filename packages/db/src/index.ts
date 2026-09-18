/**
 * Acces a la base applicative. Le client est genere depuis le schema de ce
 * paquet, qui est aussi celui que le CLI Prisma lit pour les migrations : une
 * seule source pour l'api et pour le worker.
 *
 * ESM et non CommonJS comme les autres paquets : le client genere par Prisma 7
 * emet du `import.meta`, que TypeScript refuse de transpiler en CommonJS. Rien
 * n'est perdu, seuls des consommateurs ESM le lisent.
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
