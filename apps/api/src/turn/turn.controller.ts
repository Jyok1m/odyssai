import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Post,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CanonFactSchema,
  TurnRequestSchema,
  type Situation,
  type TurnHistory,
  type TurnStreamEvent,
} from '@odyssai/schemas';
import type { LlmClient } from '@odyssai/llm';
import { GUIDANCE, TURN_PROMPT_VERSION, playTurn } from '@odyssai/narrator';
import {
  arbitrateCanon,
  bandOf,
  publicOutcome,
  rollD20,
  settledByDie,
} from '@odyssai/engine';
import { PrismaClient, type User } from '@odyssai/db';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { NarratorConfig } from '../config/narrator-config.js';
import { NARRATOR_LLM } from '../onboarding/narrator-llm.provider.js';
import { PRISMA } from '../prisma/prisma.module.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { TurnLimitsService } from './turn-limits.service.js';
import { CreditsService, OutOfCreditsError } from '../credits/credits.service.js';
import { UsageService } from '../usage/usage.service.js';
import { TurnMemoryService } from './turn-memory.service.js';
import { uuidv7 } from '../guide/guide.controller.js';

const PING_INTERVAL_MS = 15_000;
const CHANNEL = 'game_turn' as const;

/*
  Le tour de jeu.

  Le de est lance a chaque tour par le code, et le modele n'en recoit que la
  bande. Pas de classement prealable pour decider s'il faut lancer : ce serait
  le modele qui deciderait, et la decision appartient au code.
*/
@Controller('turn')
@UseGuards(SessionGuard)
export class TurnController {
  private readonly logger = new Logger(TurnController.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(NARRATOR_LLM) private readonly llm: LlmClient,
    private readonly config: NarratorConfig,
    private readonly memory: TurnMemoryService,
    private readonly limits: TurnLimitsService,
    private readonly moderation: ModerationService,
    private readonly usage: UsageService,
    private readonly credits: CreditsService,
  ) {}

  @Get()
  async history(@CurrentUser() user: User): Promise<TurnHistory> {
    const world = await this.memory.world(user.id);
    if (!world) throw new NotFoundException({ code: 'not_ready' });

    const [messages, turns, canon] = await Promise.all([
      this.prisma.conversationMessage.findMany({
        where: { universeId: world.universeId, channel: CHANNEL },
        orderBy: { seq: 'asc' },
      }),
      this.prisma.turn.findMany({ where: { universeId: world.universeId } }),
      this.prisma.canonFact.findMany({
        where: { universeId: world.universeId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // L'issue est portee par la reponse du meneur, dont le rang suit celui du
    // message qui l'a provoquee. Et seulement quand le de a servi.
    const outcomes = new Map(
      turns
        .filter((turn) => turn.usedDie)
        .map((turn) => [turn.seq + 1, publicOutcome(turn.band as never)]),
    );

    return {
      messages: messages.map((row) => ({
        id: row.id,
        seq: row.seq,
        role: row.role,
        content: row.content,
        outcome: outcomes.get(row.seq) ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      canon: canon.flatMap((row) => {
        const parsed = CanonFactSchema.safeParse({
          subject: row.subject,
          statement: row.statement,
        });
        return parsed.success ? [parsed.data] : [];
      }),
    };
  }

  @Post()
  async play(
    @CurrentUser() user: User,
    @Body() rawBody: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const parsed = TurnRequestSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException({ code: 'validation_error' });

    if (!this.config.configured) {
      throw new ServiceUnavailableException({ code: 'upstream_error' });
    }

    const request = parsed.data;

    const world = await this.memory.world(user.id);
    if (!world) throw new NotFoundException({ code: 'not_ready' });

    /*
      La langue du tour, et non celle du compte.

      Le joueur peut ecrire dans n'importe quelle langue : le meneur repond
      dans la sienne, et les consignes prennent la version anglaise des que
      ce n'est plus du francais. Le compte ne bouge pas : une phrase lachee
      en anglais ne doit pas faire basculer tout le site de quelqu'un.
    */
    let locale = user.locale;

    /*
      Ce que le classificateur a lu dans la phrase du joueur. Nulle pour une
      ouverture et pour un appel au sort, qui n'ont pas de message a lire.
    */
    let situation: Situation | null = null;

    // Avant la limite et avant tout appel : un message refuse ne doit ni
    // consommer un tour, ni atteindre le modele, ni entrer en base.
    if (request.kind === 'say') {
      const seen = await this.moderation.check(
        request.content,
        user.locale,
        user.id,
      );
      if (!seen.allow) {
        throw new HttpException(
          { code: 'refused', reason: seen.reason },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      // Une langue indetectable laisse le compte decider : un message de deux
      // mots ne doit pas faire basculer le tour.
      if (seen.language && seen.language !== 'fr') locale = 'en';

      situation = seen.situation;
    }

    /*
      Une ouverture ne vaut que pour une partie qui n'a pas commence.

      Sans cette garde, un rechargement de page en rejouerait une, et chaque
      fois pour un credit. C'est la table qui tranche, pas l'ecran : lui peut
      toujours demander, elle seule sait si quelque chose a deja ete joue.
    */
    if (request.kind === 'open') {
      const played = await this.prisma.turn.count({
        where: { universeId: world.universeId },
      });
      if (played > 0) {
        throw new HttpException(
          { code: 'already_started' },
          HttpStatus.CONFLICT,
        );
      }
    }

    const verdict = await this.limits.consume(user.id);
    if (!verdict.allowed) {
      res.setHeader('Retry-After', String(verdict.retryAfterSeconds ?? 60));
      throw new HttpException(
        { code: 'rate_limited', retryAfterSeconds: verdict.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const fate = request.kind === 'fate';
    const opening = request.kind === 'open';
    const said = request.kind === 'say' ? request.content : '';

    // Debit avant tout appel : une reserve vide refuse le tour sans rien
    // depenser, et le joueur n'a pas de facture surprise.
    let debit: string | null = null;
    try {
      debit = await this.credits.spend('turn' as const, user.id, world.universeId);
    } catch (error: unknown) {
      if (error instanceof OutOfCreditsError) {
        throw new HttpException(
          { code: 'out_of_credits', needed: error.needed, balance: error.balance },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      throw error;
    }

    const memory = await this.memory.recall(world.universeId, said);
    const seq = memory.nextSeq;

    /*
      Le rappel est occasionnel : sans etiquette, le tour se joue exactement
      comme avant ce corpus. La locale est celle du tour et non celle du
      compte, comme le reste des consignes.
    */
    const guidance = GUIDANCE.for(situation, locale);

    // Le jet est tire ici, par le code, pour chaque tour. Le modele n'en verra
    // que la bande, et ne s'en servira que si l'issue etait incertaine.
    const die = rollD20();
    const band = bandOf(die);

    // Ecrit avant l'appel : une coupure en cours de reponse ne doit pas faire
    // perdre au joueur ce qu'il a tape. Rien a ecrire a l'ouverture, ou la
    // reponse du meneur prend le premier rang.
    if (!opening) {
      await this.prisma.conversationMessage.create({
        data: {
          universeId: world.universeId,
          channel: CHANNEL,
          role: 'user',
          seq,
          content: fate ? "Je m'en remets au sort." : said,
        },
      });
    }

    // A partir d'ici, plus aucune exception ne sort : seulement du SSE.
    this.openStream(res);
    const ping = setInterval(() => res.write(': ping\n\n'), PING_INTERVAL_MS);

    /*
      Le depart du joueur arrete la diffusion, pas la generation.

      C'est l'inverse du guide, ou couper l'appel amont est juste : plus
      personne ne lit. Ici le bloc de queue doit arriver pour que le canon
      s'ecrive, et le tour doit s'enregistrer pour que le joueur le retrouve
      en revenant.
    */
    let streaming = true;
    const onClose = () => {
      streaming = false;
    };
    res.on('close', onClose);

    const turnId = uuidv7();
    let answer = '';

    try {
      const turn = playTurn({
        llm: this.llm,
        config: this.config.model,
        locale,
        context: {
          ...world,
          ...memory,
          band,
          fate,
          opening,
          guidance: guidance.map((card) => card.text),
          // Une ouverture ne tranche rien : le joueur n'a encore rien tente.
          mustUseDie: !opening && settledByDie(situation),
        },
        message: fate ? "Je ne sais pas quoi faire, que le sort decide." : said,
        trace: {
          name: 'turn',
          metadata: {
            turn_id: turnId,
            universe_id: world.universeId,
            prompt_version: TURN_PROMPT_VERSION,
            band,
            situation,
          },
        },
      });

      for await (const text of turn.chunks) {
        answer += text;
        if (streaming) this.write(res, { type: 'delta', text });
      }

      const delta = turn.delta();
      const usage = turn.usage();

      await this.usage.record({
        kind: 'turn',
        provider: this.config.provider,
        userId: user.id,
        universeId: world.universeId,
        usage,
        prices: this.config.prices,
      });

      // La reponse du meneur, relue par la couche lexicale seule : elle est
      // instantanee, et le recit est deja parti au joueur de toute facon. Un
      // second appel de classification l'aurait retarde sans rien empecher.
      if (!this.moderation.clean(answer)) {
        this.logger.warn(`reponse du meneur signalee au tour ${seq}`);
      }

      // Le canon grandit : ce qui a ete refuse a la generation ne doit pas
      // rentrer par une reponse du meneur.
      const arbitrated = arbitrateCanon(delta.facts, world.charter, []);
      for (const { fact, verdict: why } of arbitrated.rejected) {
        this.logger.warn(`fait refuse (${why.reason}) : ${fact.subject}`);
      }

      await this.prisma.$transaction([
        this.prisma.conversationMessage.create({
          data: {
            universeId: world.universeId,
            channel: CHANNEL,
            role: 'assistant',
            seq: opening ? seq : seq + 1,
            content: answer,
          },
        }),
        this.prisma.turn.create({
          data: {
            universeId: world.universeId,
            seq,
            die,
            band,
            usedDie: delta.usedDie,
            kind: delta.kind,
            learned: arbitrated.accepted.length,
            situation,
            guidance: guidance.map((card) => card.id),
            provider: this.config.provider,
            model: usage.model ?? this.config.model.model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd: UsageService.cost(usage, this.config.prices),
            traceId: turnId,
          },
        }),
        ...arbitrated.accepted.map((fact) =>
          this.prisma.canonFact.create({
            data: {
              universeId: world.universeId,
              subject: fact.subject,
              statement: fact.statement,
              seq,
            },
          }),
        ),
      ]);

      if (streaming) {
        this.write(res, {
          type: 'done',
          outcome: delta.usedDie ? publicOutcome(band) : null,
          learned: arbitrated.accepted.length,
        });
      }
    } catch (error: unknown) {
      this.logger.warn(`tour en echec : ${String(error)}`);
      // Le joueur n'a pas eu son tour : il ne doit pas l'avoir paye.
      if (debit) await this.credits.refund(debit);
      if (streaming) this.write(res, { type: 'error', code: 'upstream_error' });
    } finally {
      clearInterval(ping);
      res.off('close', onClose);
      res.end();
    }
  }

  private openStream(res: Response): void {
    // Nest repondrait 201 sur un POST : un flux n'est pas une creation.
    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Nginx bufferise les reponses par defaut, ce qui annulerait le streaming.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
  }

  private write(res: Response, event: TurnStreamEvent): void {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}
