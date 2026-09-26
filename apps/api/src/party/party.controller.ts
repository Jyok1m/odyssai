import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  PartyJoinSchema,
  PartyStartSchema,
  type DepartureOutcome,
  type Party,
} from '@odyssai/schemas';
import type { User } from '@odyssai/db';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { AlphaOpenGuard } from '../alpha/alpha-open.guard.js';
import { ErasureService } from '../erasure/erasure.service.js';
import { StoriesFullError } from '../stories/stories.service.js';
import {
  AlreadySeatedError,
  PartyClosedError,
  PartyFullError,
  PartyNotFoundError,
  PartyService,
} from './party.service.js';

/*
  Les tables : ouvrir la sienne, y recevoir ses amis, la quitter. Le code
  d'invitation se partage hors bande, il n'y a pas de courriel : les joueurs
  d'une meme table se connaissent.

  L'etat d'une table ne se lit pas ici : le parcours le porte
  (GET /onboarding), qui est l'endroit ou l'ecran attend les autres.
*/
@Controller('parties')
// L'ordre compte : le second relit le joueur que le premier depose.
@UseGuards(SessionGuard, AlphaOpenGuard)
export class PartyController {
  constructor(
    private readonly parties: PartyService,
    private readonly erasure: ErasureService,
  ) {}

  /*
    Ouvrir une table de `size` joueurs. L'histoire nait vide et s'ouvre comme
    celle d'un solo : c'est le parcours qui la remplit, chaque membre sa
    part.
  */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: User, @Body() rawBody: unknown): Promise<Party> {
    const parsed = PartyStartSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException({ code: 'validation_error' });

    try {
      return await this.parties.create(user, parsed.data.size);
    } catch (error: unknown) {
      if (error instanceof AlreadySeatedError) {
        throw new ConflictException({ code: 'in_party' });
      }
      if (error instanceof StoriesFullError) {
        throw new ConflictException({ code: 'stories_full' });
      }
      throw error;
    }
  }

  @Post('join')
  @HttpCode(HttpStatus.CREATED)
  async join(@CurrentUser() user: User, @Body() rawBody: unknown): Promise<Party> {
    const parsed = PartyJoinSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException({ code: 'validation_error' });

    try {
      return await this.parties.join(user, parsed.data.code);
    } catch (error: unknown) {
      if (error instanceof AlreadySeatedError) {
        throw new ConflictException({ code: 'in_party' });
      }
      if (error instanceof PartyNotFoundError) {
        throw new NotFoundException({ code: 'not_found' });
      }
      if (error instanceof PartyFullError) {
        throw new ConflictException({ code: 'party_full' });
      }
      if (error instanceof PartyClosedError) {
        throw new ConflictException({ code: 'locked' });
      }
      throw error;
    }
  }

  /*
    Quitter sa table, ouverte ou non.

    Refuse pendant la generation, comme tout depart : le worker ecrit ce
    monde-la, et le siege de quelqu'un qui l'a paye ne s'efface pas sous
    lui. Le sort du monde repond selon la regle du depart, et le joueur
    reste sans histoire ouverte.
  */
  @Delete('me')
  async leave(@CurrentUser() user: User): Promise<DepartureOutcome> {
    const seat = await this.parties.seatOf(user.id);
    if (!seat) throw new NotFoundException({ code: 'not_found' });

    if (seat.universe.step === 'generating') {
      throw new ConflictException({ code: 'locked' });
    }

    return this.erasure.releaseMembership(user.id);
  }

  /*
    La table ou le joueur siege, avec ses sieges. Le parcours la porte deja :
    cette lecture sert a retrouver un code quand le parcours est fini.
  */
  @Get('me')
  async mine(@CurrentUser() user: User): Promise<Party> {
    const seat = await this.parties.seatOf(user.id);
    if (!seat) throw new NotFoundException({ code: 'not_found' });
    return this.parties.read(user, seat.id);
  }
}
