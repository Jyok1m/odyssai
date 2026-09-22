import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  WorldBibleSchema,
  WorldCharterSchema,
  WorldViewSchema,
  type GenerationStreamEvent,
  type WorldView,
} from '@odyssai/schemas';
import { PrismaClient, type User } from '@odyssai/db';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { PRISMA } from '../prisma/prisma.module.js';

const PING_INTERVAL_MS = 15_000;

/*
  Cadence de relecture. La generation dure des minutes et avance par paliers :
  interroger la base plus souvent ne montrerait rien de plus.
*/
const POLL_INTERVAL_MS = 2_000;

/*
  Au dela, le flux se ferme et le navigateur rouvre : sept appels de modele
  peuvent trainer, mais pas indefiniment.
*/
const STREAM_MAX_MS = 600_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/*
  Avancement de la generation, et monde une fois qu'il existe.

  L'avancement se lit dans `generation_jobs` plutot que par un canal Redis
  publie par le worker : la table est deja la source de verite, elle survit a
  un redemarrage, et deux instances d'api y lisent la meme chose.
*/
@Controller()
@UseGuards(SessionGuard)
export class GenerationController {
  private readonly logger = new Logger(GenerationController.name);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get('onboarding/generation')
  async progress(@CurrentUser() user: User, @Res() res: Response): Promise<void> {
    this.openStream(res);
    const ping = setInterval(() => res.write(': ping\n\n'), PING_INTERVAL_MS);

    // Sur la reponse et non sur la requete : `req` se ferme des que le corps
    // est entierement lu, donc bien avant le depart du joueur.
    let open = true;
    const onClose = () => {
      open = false;
    };
    res.on('close', onClose);

    const deadline = Date.now() + STREAM_MAX_MS;

    try {
      while (open && Date.now() < deadline) {
        const universe = await this.prisma.universe.findUnique({
          where: { ownerId: user.id },
          select: {
            step: true,
            name: true,
            jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        });

        if (!universe) {
          this.write(res, { type: 'error', code: 'internal_error' });
          return;
        }

        if (universe.step === 'ready') {
          this.write(res, { type: 'ready', name: universe.name ?? '' });
          return;
        }

        const job = universe.jobs[0];

        if (universe.step === 'failed' || job?.status === 'failed') {
          this.write(res, { type: 'failed', error: job?.error ?? null });
          return;
        }

        this.write(res, {
          type: 'progress',
          status: job?.status === 'running' ? 'running' : 'queued',
          step: job?.step ?? null,
          attempts: job?.attempts ?? 0,
        });

        await sleep(POLL_INTERVAL_MS);
      }

      if (open) this.write(res, { type: 'error', code: 'timeout' });
    } catch (error: unknown) {
      this.logger.warn(`avancement de generation en echec : ${String(error)}`);
      this.write(res, { type: 'error', code: 'internal_error' });
    } finally {
      clearInterval(ping);
      res.off('close', onClose);
      res.end();
    }
  }

  @Get('world')
  async world(@CurrentUser() user: User): Promise<WorldView> {
    const universe = await this.prisma.universe.findUnique({
      where: { ownerId: user.id },
      include: { character: true },
    });

    if (!universe) throw new NotFoundException({ code: 'not_found' });
    if (universe.step !== 'ready') {
      throw new NotFoundException({ code: 'not_ready' });
    }

    const charter = WorldCharterSchema.safeParse(universe.charter);
    const bible = WorldBibleSchema.safeParse(universe.bible);
    if (!charter.success || !bible.success) {
      // L'etape dit `ready` mais le contenu ne tient pas : c'est un defaut de
      // notre cote, pas une demande invalide.
      this.logger.error(`monde ${universe.id} illisible malgre l'etape ready`);
      throw new NotFoundException({ code: 'not_ready' });
    }

    // Le schema de vue laisse tomber les secrets des personnages : ils se
    // decouvriront en jeu, et un champ qu'un type ne porte pas ne fuite pas.
    return WorldViewSchema.parse({
      name: bible.data.lore.name,
      accentHue: bible.data.lore.accentHue,
      charter: charter.data,
      lore: bible.data.lore,
      factions: bible.data.factions,
      npcs: bible.data.npcs,
      affinities: bible.data.affinities,
      character: {
        name: universe.character?.name,
        gender: universe.character?.gender,
        age: universe.character?.age,
        personality: universe.character?.personality,
        attributes: universe.character?.attributes,
      },
    });
  }

  private openStream(res: Response): void {
    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Nginx bufferise les reponses par defaut, ce qui annulerait le streaming.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
  }

  private write(res: Response, event: GenerationStreamEvent): void {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}
