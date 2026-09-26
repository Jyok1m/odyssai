import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ChronicleSchema,
  entityKey,
  type Chronicle,
  type ChronicleDecisions,
} from '@odyssai/schemas';
import { PrismaClient, type User } from '@odyssai/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { StoryNotFoundError } from './stories.service.js';

type Owner = Pick<User, 'id'>;

/*
  La chronique des voyageurs.

  Une visite ecrit toujours chez elle : ses tours, ses entites, son canon. Ce
  qu'elle laisse ne devient vrai dans le monde de l'hote que lorsque celui a
  qui ce monde appartient le decide. C'est ce qui fait tenir « un univers
  n'ecrit jamais dans l'etat d'un autre » jusqu'au bout : au moment ou la
  matiere passe, c'est l'hote qui ecrit, dans son monde.

  Ce qui se valide, c'est la matiere du monde : les faits entres au canon et
  les entites nees pendant la visite. Les tours du visiteur sont sa partie a
  lui et le restent.
*/
@Injectable()
export class ChronicleService {
  private readonly logger = new Logger(ChronicleService.name);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /*
    Ce qui attend une decision, par monde. Une seule passe pour toute la
    liste : compter monde par monde ferait une requete par carte.
  */
  async pending(user: Owner): Promise<Map<string, number>> {
    const visits = await this.prisma.universe.findMany({
      where: { visiting: { ownerId: user.id } },
      select: { id: true, visitingId: true },
    });
    if (visits.length === 0) return new Map();

    const ids = visits.map((visit) => visit.id);
    const [facts, entities] = await Promise.all([
      this.prisma.canonFact.groupBy({
        by: ['universeId'],
        where: { universeId: { in: ids }, accepted: null },
        _count: { _all: true },
      }),
      this.prisma.entity.groupBy({
        by: ['universeId'],
        where: { universeId: { in: ids }, accepted: null },
        _count: { _all: true },
      }),
    ]);

    const host = new Map(visits.map((visit) => [visit.id, visit.visitingId!]));
    const counted = new Map<string, number>();
    for (const row of [...facts, ...entities]) {
      const world = host.get(row.universeId);
      if (!world) continue;
      counted.set(world, (counted.get(world) ?? 0) + row._count._all);
    }
    return counted;
  }

  // Les visites recues par un monde, et ce qu'elles laissent a relire.
  async read(user: Owner, universeId: string): Promise<Chronicle> {
    await this.assertHost(user, universeId);

    const visits = await this.prisma.universe.findMany({
      where: { visitingId: universeId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        createdAt: true,
        owner: { select: { username: true } },
        characters: { select: { name: true }, take: 1 },
        _count: { select: { turns: true } },
        canon: {
          where: { accepted: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true, subject: true, statement: true },
        },
        entities: {
          where: { accepted: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, kind: true, known: true },
        },
      },
    });

    return ChronicleSchema.parse({
      // Une visite qui n'a rien laisse n'a rien a faire dans une liste de
      // choses a relire.
      visits: visits
        .filter((visit) => visit.canon.length > 0 || visit.entities.length > 0)
        .map((visit) => ({
          visitId: visit.id,
          visitor: visit.owner?.username ?? null,
          character: visit.characters[0]?.name ?? null,
          turns: visit._count.turns,
          at: visit.createdAt.toISOString(),
          entries: [
            ...visit.canon.map((fact) => ({
              id: fact.id,
              kind: 'fact' as const,
              subject: fact.subject,
              statement: fact.statement,
              entity: null,
            })),
            ...visit.entities.map((row) => ({
              id: row.id,
              kind: 'entity' as const,
              subject: row.name,
              // Le su seulement : le cache d'une entite reste au meneur.
              statement: row.known,
              entity: row.kind,
            })),
          ],
        })),
    });
  }

  /*
    Ce que l'hote decide.

    Accepter recopie dans son monde ; refuser ne fait que clore la question.
    Dans les deux cas la ligne d'origine reste chez le visiteur : ce qu'il a
    vecu ne se retire pas parce que l'hote n'en fait pas une verite chez lui.
  */
  async decide(
    user: Owner,
    universeId: string,
    decisions: ChronicleDecisions,
  ): Promise<Chronicle> {
    await this.assertHost(user, universeId);

    const facts = decisions.decisions.filter((one) => one.kind === 'fact');
    const entities = decisions.decisions.filter((one) => one.kind === 'entity');

    /*
      Les lignes sont relues sous la contrainte « nee dans une visite de ce
      monde-ci, pas encore tranchee » : une decision ne peut donc pas porter
      sur le canon d'un autre monde, meme en devinant un identifiant.
    */
    const [chosenFacts, chosenEntities] = await Promise.all([
      facts.length > 0
        ? this.prisma.canonFact.findMany({
            where: {
              id: { in: facts.map((one) => one.id) },
              accepted: null,
              universe: { visitingId: universeId },
            },
          })
        : [],
      entities.length > 0
        ? this.prisma.entity.findMany({
            where: {
              id: { in: entities.map((one) => one.id) },
              accepted: null,
              universe: { visitingId: universeId },
            },
          })
        : [],
    ]);

    const accepted = new Map(
      decisions.decisions.map((one) => [one.id, one.accept] as const),
    );

    // Ce que le monde porte deja : sa version l'emporte, c'est le sien.
    const known = new Set(
      (
        await this.prisma.entity.findMany({
          where: { universeId },
          select: { key: true },
        })
      ).map((row) => row.key),
    );

    await this.prisma.$transaction([
      ...chosenFacts.map((fact) =>
        this.prisma.canonFact.update({
          where: { id: fact.id },
          data: { accepted: accepted.get(fact.id) ?? false },
        }),
      ),
      ...chosenEntities.map((row) =>
        this.prisma.entity.update({
          where: { id: row.id },
          data: { accepted: accepted.get(row.id) ?? false },
        }),
      ),
      // La recopie : c'est l'hote qui ecrit, dans son monde.
      ...chosenFacts
        .filter((fact) => accepted.get(fact.id))
        .map((fact) =>
          this.prisma.canonFact.create({
            data: {
              universeId,
              subject: fact.subject,
              statement: fact.statement,
              seq: fact.seq,
            },
          }),
        ),
      ...chosenEntities
        .filter((row) => accepted.get(row.id) && !known.has(row.key))
        .map((row) =>
          this.prisma.entity.create({
            data: {
              universeId,
              kind: row.kind,
              name: row.name,
              key: entityKey(row.name),
              known: row.known,
              hidden: row.hidden,
              seq: row.seq,
            },
          }),
        ),
    ]);

    return this.read(user, universeId);
  }

  // Le monde doit etre le sien : celui d'un autre n'existe pas pour lui.
  private async assertHost(user: Owner, universeId: string): Promise<void> {
    const mine = await this.prisma.universe.findUnique({
      where: { id: universeId, ownerId: user.id },
      select: { id: true },
    });
    if (!mine) throw new StoryNotFoundError();
  }
}
