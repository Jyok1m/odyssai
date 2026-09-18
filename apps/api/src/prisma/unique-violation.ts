import { Prisma } from '@odyssai/db';

/**
 * Une contrainte d'unicite a saute.
 *
 * Partage plutot que recopie : trois services en dependent, et c'est toujours
 * pour la meme raison. Deux requetes du meme joueur arrivent ensemble, toutes
 * les deux lisent une ligne absente, toutes les deux l'ecrivent, et celle qui
 * perd n'a qu'a relire. La base tranche, le code s'y range.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
