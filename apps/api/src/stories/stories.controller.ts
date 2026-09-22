import {
  BadRequestException,
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
import type { DepartureOutcome, Stories, Story } from '@odyssai/schemas';
import type { User } from '@odyssai/db';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ErasureService } from '../erasure/erasure.service.js';
import {
  StoriesFullError,
  StoriesService,
  StoryNotFoundError,
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

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async start(@CurrentUser() user: User): Promise<Story> {
    try {
      return await this.stories.start(user);
    } catch (error: unknown) {
      if (error instanceof StoriesFullError) {
        throw new ConflictException({ code: 'stories_full' });
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
