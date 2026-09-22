import { Inject, Injectable } from '@nestjs/common';
import { ALPHA_SEATS } from '@odyssai/engine';
import { PRISMA } from '../prisma/prisma.module.js';
import { isUniqueViolation } from '../prisma/unique-violation.js';
import { Prisma, PrismaClient, type User } from '@odyssai/db';

// Le pseudo du joueur est deja pose : il ne se choisit qu'une fois.
export class UsernameLockedError extends Error {
  constructor() {
    super('pseudo deja pose');
    this.name = 'UsernameLockedError';
  }
}

// Le pseudo est deja pris, a la casse pres.
export class UsernameTakenError extends Error {
  constructor() {
    super('pseudo deja pris');
    this.name = 'UsernameTakenError';
  }
}

/*
  L'alpha est complete : ce compte n'aura pas de joueur derriere lui.

  Une fermeture, pas une panne. L'ecran doit le dire autrement qu'un echec
  technique : proposer de reessayer a quelqu'un qui n'entrera jamais serait
  lui mentir.
*/
export class AlphaFullError extends Error {
  readonly seats: number;

  constructor(seats: number) {
    super(`les ${seats} places de l'alpha sont prises`);
    this.name = 'AlphaFullError';
    this.seats = seats;
  }
}

// Ce que le realm apprend d'un joueur : son sujet, et le miroir d'identite.
export interface RealmIdentity {
  keycloakId: string;
  email: string;
  emailVerified: boolean;
}

@Injectable()
export class UsersService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /*
    Au retour de Keycloak. Seul moment ou l'on ecrit le miroir : le realm est
    seul a pouvoir le faire changer, et une connexion est le seul instant ou
    l'on en apprend la valeur courante.
  */
  async signIn(identity: RealmIdentity): Promise<User> {
    const lastLoginAt = new Date();

    // Une lecture de plus par connexion, et seulement la : c'est ici que la
    // ligne d'un joueur nait, donc le seul endroit ou une place se prend.
    const known = await this.prisma.user.findUnique({
      where: { keycloakId: identity.keycloakId },
      select: { id: true },
    });
    if (!known) await this.assertSeat();

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

  /*
    Resout la ligne sans rien ecrire quand elle existe : cette lecture est sur
    le chemin de chaque requete protegee. La creation ne sert qu'aux sessions
    ouvertes avant que le provisionnement existe.
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

  /*
    Pose le pseudo du joueur. Le replie est ecrit ici et nulle part ailleurs :
    c'est lui qui porte l'unicite insensible a la casse, et une ecriture qui
    l'oublierait laisserait passer un doublon.
  */
  async setUsername(userId: string, username: string): Promise<User> {
    // La regle tient ici et pas seulement a l'ecran : un PATCH direct
    // contournerait un garde qui ne vivrait que dans le navigateur.
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    if (current?.username) throw new UsernameLockedError();

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { username, usernameFolded: username.toLowerCase() },
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) throw new UsernameTakenError();
      throw error;
    }
  }

  /*
    Pose ou retire le consentement, en horodatant le changement.

    La date est ecrite dans les deux sens : un retrait doit se prouver aussi
    bien qu'un accord, et c'est la meme colonne qui les porte.
  */
  async setMarketingOptIn(userId: string, optIn: boolean): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { marketingOptIn: optIn, marketingOptInAt: new Date() },
    });
  }

  // Vrai quand plus aucune place n'est libre. Lecture seule, sans effet.
  async alphaFull(): Promise<boolean> {
    const taken = await this.prisma.user.count({ where: { isAdmin: false } });
    return taken >= ALPHA_SEATS;
  }

  /*
    Refuse la centieme et unieme inscription. Les administrateurs ne sont pas
    comptes.

    Le compte est lu, pas verrouille : deux inscriptions dans la meme
    milliseconde a la centieme place passeraient toutes les deux. Assume pour
    une alpha qu'on ouvre a la main, plus le jour ou la place se vend.
  */
  private async assertSeat(): Promise<void> {
    if (await this.alphaFull()) throw new AlphaFullError(ALPHA_SEATS);
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
