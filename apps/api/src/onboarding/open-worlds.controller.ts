import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  OpenWorldsSchema,
  VisitStartSchema,
  WorldCharterSchema,
  type OpenWorlds,
  type Story,
} from '@odyssai/schemas';
import { PrismaClient, type User } from '@odyssai/db';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { PRISMA } from '../prisma/prisma.module.js';
import {
  StoriesFullError,
  StoriesService,
  TravellerNotFoundError,
  WorldNotOpenError,
} from '../stories/stories.service.js';

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

  On y entre par `POST /worlds/:id/visit`, avec un personnage a soi. La visite
  est une histoire du visiteur qui emprunte le monde de l'hote : elle a ses
  tours, ses entites et son canon, et n'ecrit jamais chez lui.

  Ce qui manque encore : la chronique, le recit de la visite envoye au
  createur pour qu'il valide ce qui en devient vrai chez lui. Tant qu'elle
  n'existe pas, ce qu'un visiteur ecrit reste de son cote.
*/
@Controller('worlds')
@UseGuards(SessionGuard)
export class OpenWorldsController {
  private readonly logger = new Logger(OpenWorldsController.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly stories: StoriesService,
  ) {}

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

  /*
    Franchir une faille. Rien n'est genere ni debite : le monde existe deja,
    et ce sont les tours qui coutent, comme partout.
  */
  @Post(':id/visit')
  @HttpCode(HttpStatus.CREATED)
  async visit(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() rawBody: unknown,
  ): Promise<Story> {
    if (!z.uuid().safeParse(id).success) {
      throw new NotFoundException({ code: 'not_found' });
    }

    const parsed = VisitStartSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException({ code: 'validation_error' });

    try {
      return await this.stories.visit(user, id, parsed.data.essenceId);
    } catch (error: unknown) {
      if (error instanceof WorldNotOpenError) {
        throw new NotFoundException({ code: 'world_not_open' });
      }
      if (error instanceof TravellerNotFoundError) {
        throw new NotFoundException({ code: 'traveller_not_found' });
      }
      if (error instanceof StoriesFullError) {
        throw new ConflictException({ code: 'stories_full' });
      }
      throw error;
    }
  }
}
