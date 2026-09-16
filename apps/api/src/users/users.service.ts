import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '../prisma/prisma.module.js';
import { Prisma, PrismaClient, type User } from '../generated/prisma/client.js';

/** Ce que le realm apprend d'un joueur : son sujet, et le miroir d'identite. */
export interface RealmIdentity {
  keycloakId: string;
  email: string;
  emailVerified: boolean;
}

@Injectable()
export class UsersService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /**
   * Au retour de Keycloak. Seul moment ou l'on ecrit le miroir : le realm est
   * seul a pouvoir le faire changer, et une connexion est le seul instant ou
   * l'on en apprend la valeur courante.
   */
  async signIn(identity: RealmIdentity): Promise<User> {
    const lastLoginAt = new Date();
    return this.upsert(identity.keycloakId, {
      create: {
        keycloakId: identity.keycloakId,
        email: identity.email,
        emailVerified: identity.emailVerified,
        lastLoginAt,
      },
      update: {
        email: identity.email,
        emailVerified: identity.emailVerified,
        lastLoginAt,
      },
    });
  }

  /**
   * Resout la ligne sans rien ecrire quand elle existe : cette lecture est sur
   * le chemin de chaque requete protegee. La creation ne sert qu'aux sessions
   * ouvertes avant que le provisionnement existe.
   */
  async resolve(identity: RealmIdentity): Promise<User> {
    const existing = await this.prisma.user.findUnique({
      where: { keycloakId: identity.keycloakId },
    });
    if (existing) return existing;

    return this.upsert(identity.keycloakId, {
      create: {
        keycloakId: identity.keycloakId,
        email: identity.email,
        emailVerified: identity.emailVerified,
      },
      update: {},
    });
  }

  private async upsert(
    keycloakId: string,
    args: { create: Prisma.UserCreateInput; update: Prisma.UserUpdateInput },
  ): Promise<User> {
    try {
      return await this.prisma.user.upsert({ where: { keycloakId }, ...args });
    } catch (error: unknown) {
      // P2002 : deux requetes du meme joueur sont arrivees ensemble et l'upsert
      // n'a pas ete traduit en ON CONFLICT natif. La ligne existe desormais,
      // celle des deux qui a perdu n'a qu'a la relire.
      if (!isUniqueViolation(error)) throw error;

      const user = await this.prisma.user.findUnique({ where: { keycloakId } });
      if (!user) throw error;
      return user;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
