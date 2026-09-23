import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { User } from '@odyssai/db';
import { BugReportRequestSchema, SCREENSHOT_MAX_BYTES } from '@odyssai/schemas';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { BugsService, type UploadedImage } from './bugs.service.js';

/*
  Un joueur signale un bug. Derriere la session mais pas derriere l'ouverture
  du jeu : c'est porte fermee qu'on a le plus besoin d'entendre ce qui cloche.

  Multipart, parce que la capture n'a rien a faire dans un JSON : multer la
  borne en octets avant que quoi que ce soit ne soit lu.
*/
@Controller('bugs')
@UseGuards(SessionGuard)
export class BugsController {
  constructor(private readonly bugs: BugsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('screenshot', { limits: { fileSize: SCREENSHOT_MAX_BYTES, files: 1 } }),
  )
  async submit(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Body() body: unknown,
    @UploadedFile() screenshot?: UploadedImage,
  ): Promise<{ received: true }> {
    const parsed = BugReportRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: 'invalid_request' });

    await this.bugs.submit(user.id, parsed.data, req.header('user-agent') ?? '', screenshot);
    return { received: true };
  }
}
