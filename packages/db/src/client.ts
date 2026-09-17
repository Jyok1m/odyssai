import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

/**
 * Construit le client. L'adaptateur vit ici et non chez l'appelant : Prisma 7
 * n'embarque plus de moteur de requete, la connexion passe forcement par un
 * adaptateur de pilote, et c'est la seule facon de se connecter a cette base.
 * La dupliquer dans l'api puis dans le worker les ferait deriver.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
