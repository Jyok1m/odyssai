import {
  BadRequestException,
  ConflictException,
  Controller,
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
import type { Stories, Story } from '@odyssai/schemas';
import type { User } from '@odyssai/db';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
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
  constructor(private readonly stories: StoriesService) {}

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
    if (!z.uuid().safeParse(id).success) {
      throw new BadRequestException({ code: 'validation_error' });
    }

    try {
      return await this.stories.select(user, id);
    } catch (error: unknown) {
      if (error instanceof StoryNotFoundError) {
        throw new NotFoundException({ code: 'not_found' });
      }
      throw error;
    }
  }
}
