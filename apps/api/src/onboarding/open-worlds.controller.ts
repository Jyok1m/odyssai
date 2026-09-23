import { Controller, Get, Inject, Logger, UseGuards } from '@nestjs/common';
import {
  OpenWorldsSchema,
  WorldCharterSchema,
  type OpenWorlds,
} from '@odyssai/schemas';
import { PrismaClient, type User } from '@odyssai/db';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { PRISMA } from '../prisma/prisma.module.js';

/*
  Au dela, la liste cesse d'etre un choix et devient un catalogue. L'alpha
  tient cent places : personne n'atteindra cette borne de sitot, et le jour ou
  elle serait atteinte, il faudra trier plutot que paginer.
*/
const OPEN_WORLDS_MAX = 40;

/*
  Les mondes que d'autres joueurs ont ouverts.

  Un monde est ferme par defaut : ce que cette route rend, ce sont ceux dont
  le createur a decide le contraire. Les siens n'y sont pas, il les a deja
  sous la main.

  Elle ne sert encore a rien d'autre qu'a regarder : personne ne peut franchir
  une faille vers le monde d'un autre. Ce qui manque n'est pas la porte mais
  ce qui se passe derriere : ou s'ecrit ce que le visiteur y fait, puisqu'un
  univers n'ecrit jamais dans l'etat d'un autre, et qui valide ce qui en
  devient vrai.
*/
@Controller('worlds')
@UseGuards(SessionGuard)
export class OpenWorldsController {
  private readonly logger = new Logger(OpenWorldsController.name);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get('open')
  async open(@CurrentUser() user: User): Promise<OpenWorlds> {
    const rows = await this.prisma.universe.findMany({
      where: {
        isOpen: true,
        step: 'ready',
        // Les siens ne sont pas une decouverte.
        ownerId: { not: user.id },
        // Un monde detache de son joueur n'a plus d'hote pour arbitrer une
        // visite : il reste lisible par ceux qui l'ont vu, pas offert.
        NOT: { ownerId: null },
      },
      orderBy: { updatedAt: 'desc' },
      take: OPEN_WORLDS_MAX,
      select: {
        id: true,
        name: true,
        accentHue: true,
        charter: true,
        owner: { select: { username: true } },
      },
    });

    return OpenWorldsSchema.parse({
      /*
        Une charte illisible fait sauter le monde plutot que la liste : c'est
        un monde qu'on ne pourrait de toute facon pas jouer.
      */
      worlds: rows.flatMap((row) => {
        const charter = WorldCharterSchema.safeParse(row.charter);
        if (!charter.success || !row.name || row.accentHue === null) {
          this.logger.warn(`monde ouvert ${row.id} illisible, ecarte de la liste`);
          return [];
        }

        return [
          {
            universeId: row.id,
            name: row.name,
            accentHue: row.accentHue,
            premise: charter.data.premise,
            tone: charter.data.tone,
            host: row.owner?.username ?? null,
          },
        ];
      }),
    });
  }
}
