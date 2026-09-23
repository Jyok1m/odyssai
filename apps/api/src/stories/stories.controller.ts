import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  StoryStartSchema,
  type DepartureOutcome,
  type Stories,
  type Story,
  type Travellers,
} from '@odyssai/schemas';
import type { User } from '@odyssai/db';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ErasureService } from '../erasure/erasure.service.js';
import {
  StoriesFullError,
  StoriesService,
  StoryNotFoundError,
  TravellerNotFoundError,
} from './stories.service.js';

/*
  Les histoires d'un joueur : les lister, en commencer une, en ouvrir une
  autre. Ce qui se passe dans l'histoire ouverte reste l'affaire du parcours
  et du tour, qui la lisent par le pointeur.
*/
@Controller('stories')
@UseGuards(SessionGuard)
export class StoriesController {
  constructor(
    private readonly stories: StoriesService,
    private readonly erasure: ErasureService,
  ) {}

  @Get()
  list(@CurrentUser() user: User): Promise<Stories> {
    return this.stories.list(user);
  }

  /*
    Les personnages du joueur, pour choisir lequel reprendre. Ici plutot que
    dans un module a part : c'est au moment de commencer une histoire qu'on
    s'en sert, et un module de plus aurait importe `AuthModule` pour son seul
    garde de session.
  */
  @Get('travellers')
  travellers(@CurrentUser() user: User): Promise<Travellers> {
    return this.stories.travellers(user);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async start(@CurrentUser() user: User, @Body() rawBody: unknown): Promise<Story> {
    // Un corps absent vaut un personnage neuf : le bouton ordinaire n'envoie
    // rien, et il n'a pas a envoyer un objet vide pour cela.
    const parsed = StoryStartSchema.safeParse(rawBody ?? {});
    if (!parsed.success) throw new BadRequestException({ code: 'validation_error' });

    try {
      return await this.stories.start(user, parsed.data.essenceId);
    } catch (error: unknown) {
      if (error instanceof StoriesFullError) {
        throw new ConflictException({ code: 'stories_full' });
      }
      if (error instanceof TravellerNotFoundError) {
        throw new NotFoundException({ code: 'traveller_not_found' });
      }
      throw error;
    }
  }

  @Put(':id/current')
  async select(@CurrentUser() user: User, @Param('id') id: string): Promise<Story> {
    this.assertId(id);

    try {
      return await this.stories.select(user, id);
    } catch (error: unknown) {
      if (error instanceof StoryNotFoundError) {
        throw new NotFoundException({ code: 'not_found' });
      }
      throw error;
    }
  }

  /*
    Supprimer une histoire, ouverte ou non, selon la regle du depart. Refuse
    pendant la generation, comme le recommencement : effacer un monde qu'un
    worker ecrit le ferait echouer sur une ligne disparue.
  */
  @Delete(':id')
  async remove(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<DepartureOutcome> {
    this.assertId(id);

    let step: Story['step'];
    try {
      ({ step } = await this.stories.find(user, id));
    } catch (error: unknown) {
      if (error instanceof StoryNotFoundError) {
        throw new NotFoundException({ code: 'not_found' });
      }
      throw error;
    }
    if (step === 'generating') throw new ConflictException({ code: 'locked' });

    return this.erasure.releaseStory(user.id, id);
  }

  private assertId(id: string): void {
    if (!z.uuid().safeParse(id).success) {
      throw new BadRequestException({ code: 'validation_error' });
    }
  }
}
