import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import {
  PARTY_CODE_ALPHABET,
  PARTY_CODE_LENGTH,
  normalizePartyCode,
  type Party,
} from '@odyssai/schemas';
import { Prisma, PrismaClient, type User } from '@odyssai/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { StoriesService } from '../stories/stories.service.js';

// Le joueur siege deja a une table : il n'en ouvre pas une seconde.
export class AlreadySeatedError extends Error {
  constructor() {
    super('deja assis a une table');
    this.name = 'AlreadySeatedError';
  }
}

// Le code ne correspond a aucune table ouverte.
export class PartyNotFoundError extends Error {
  constructor() {
    super('table inconnue');
    this.name = 'PartyNotFoundError';
  }
}

// La table est pleine.
export class PartyFullError extends Error {
  constructor() {
    super('table pleine');
    this.name = 'PartyFullError';
  }
}

// L'histoire a quitte l'inspiration : on ne la rejoint plus.
export class PartyClosedError extends Error {
  constructor() {
    super('table deja partie');
    this.name = 'PartyClosedError';
  }
}

type Owner = Pick<User, 'id' | 'currentUniverseId'>;

// La lecture d'une table avec ses sieges, membres d'abord.
const WITH_MEMBERS = {
  members: {
    orderBy: { joinedAt: 'asc' },
    include: { user: { select: { username: true } } },
  },
} as const satisfies Prisma.PartyInclude;

type WithMembers = Prisma.PartyGetPayload<{ include: typeof WITH_MEMBERS }>;

/*
  Une histoire jouee a plusieurs : ouvrir la table, y sieger, et l'etat qu'en
  lit le parcours. Le depart vit dans ErasureService, qui decide du sort des
  mondes : quitter une table est un depart, pas une suppression.

  Tout ce qui est partage vit sur l'univers, tout ce qui est personnel vit
  sur le siege : ses oeuvres citees, son avancee, sa fiche.
*/
@Injectable()
export class PartyService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly stories: StoriesService,
  ) {}

  /*
    Ouvrir une table. L'histoire nait vide, a l'inspiration, comme celle d'un
    solo : le parcours la remplit, chaque membre sa part. Elle compte dans la
    borne de l'hote, puisqu'elle est la sienne.
  */
  async create(user: User, size: number): Promise<Party> {
    if (await this.seated(user.id)) throw new AlreadySeatedError();

    // L'histoire d'abord : la borne peut la refuser, et rien ne doit etre
    // ecrit avant.
    const story = await this.stories.start(user);

    // Le code, unique : on regarde avant de poser, et on repose s'il tombe
    // sur un existant. Huit caracteres tires, la collision est rare et le
    // nombre de tables vivantes est petit.
    const inviteCode = await this.drawCode();

    const party = await this.prisma.party.create({
      data: {
        universeId: story.id,
        size,
        inviteCode,
        members: {
          create: { userId: user.id, isHost: true },
        },
      },
      include: WITH_MEMBERS,
    });

    return this.toParty(party, user.id);
  }

  /*
    S'asseoir a une table. Tant que l'histoire est a l'inspiration, la porte
    est ouverte ; des qu'elle avance, chacun ecrit la sienne et un retardataire
    n'aurait rien a y faire.
  */
  async join(user: User, code: string): Promise<Party> {
    if (await this.seated(user.id)) throw new AlreadySeatedError();

    const folded = normalizePartyCode(code);
    if (folded.length !== PARTY_CODE_LENGTH) throw new PartyNotFoundError();

    const party = await this.prisma.party.findUnique({
      where: { inviteCode: folded },
      include: { ...WITH_MEMBERS, universe: { select: { step: true } } },
    });
    if (!party) throw new PartyNotFoundError();

    if (party.universe.step !== 'inspiration') throw new PartyClosedError();
    if (party.members.length >= party.size) throw new PartyFullError();

    const [row] = await this.prisma.$transaction([
      this.prisma.partyMember.create({
        data: { partyId: party.id, userId: user.id },
      }),
      // Ouvrir l'histoire comme le ferait PUT /stories/:id/current : c'est
      // celle qu'il vient de rejoindre.
      this.prisma.user.update({
        where: { id: user.id },
        data: { currentUniverseId: party.universeId },
      }),
    ]);

    return this.read(user, row.partyId);
  }

  // La table ou le joueur siege, ou rien. L'etape de l'histoire vient avec :
  // c'est elle qui refuse les departs pendant la generation.
  async seatOf(userId: string): Promise<WithMembers & { universe: { step: string } } | null> {
    const member = await this.prisma.partyMember.findUnique({
      where: { userId },
      select: { partyId: true },
    });
    if (!member) return null;

    return this.prisma.party.findUnique({
      where: { id: member.partyId },
      include: { ...WITH_MEMBERS, universe: { select: { step: true } } },
    });
  }

  async read(user: Owner, partyId: string): Promise<Party> {
    const party = await this.prisma.party.findUnique({
      where: { id: partyId },
      include: WITH_MEMBERS,
    });
    if (!party) throw new PartyNotFoundError();
    return this.toParty(party, user.id);
  }

  private async seated(userId: string): Promise<boolean> {
    const member = await this.prisma.partyMember.findUnique({
      where: { userId },
      select: { id: true },
    });
    return member !== null;
  }

  private async drawCode(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = Array.from(
        { length: PARTY_CODE_LENGTH },
        () => PARTY_CODE_ALPHABET[randomInt(PARTY_CODE_ALPHABET.length)]!,
      ).join('');

      const clash = await this.prisma.party.findUnique({
        where: { inviteCode: code },
        select: { id: true },
      });
      if (!clash) return code;
    }
    // Huit caracteres sur un alphabet de trente-deux : il faudrait un
    // milliard de tables vivantes pour l'atteindre.
    throw new Error('code de table epuise');
  }

  /*
    La table telle que le parcours et le monde la servent : les sieges, qui
    est pret, et la fiche de chacun. Le pseudo y figure aussi : avant les
    fiches, c'est le seul nom qu'on ait a montrer.
  */
  toParty(party: WithMembers, userId: string): Party {
    return {
      id: party.id,
      universeId: party.universeId,
      size: party.size,
      inviteCode: party.inviteCode,
      members: party.members.map((member) => ({
        userId: member.userId,
        username: member.user.username,
        characterName: null,
        ready: member.ready,
        host: member.isHost,
        mine: member.userId === userId,
      })),
    };
  }

  /*
    Ce qu'il faut des sieges pour jouer les personnages : les fiches par
    proprietaire. Le personnage d'un membre est le sien dans cet univers, et
    lui seul.
  */
  async actorsOf(universeId: string): Promise<Map<string, string>> {
    const characters = await this.prisma.character.findMany({
      where: { universeId, ownerId: { not: null } },
      select: { ownerId: true, name: true },
    });

    return new Map(
      characters.flatMap((row) =>
        row.ownerId && row.name ? [[row.ownerId, row.name] as const] : [],
      ),
    );
  }

  // Remplir les noms de personnages d'une table, pour l'afficher.
  async withCharacterNames(party: Party): Promise<Party> {
    const names = await this.actorsOf(party.universeId);
    return {
      ...party,
      members: party.members.map((member) => ({
        ...member,
        characterName: names.get(member.userId) ?? null,
      })),
    };
  }
}
