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
  attributeFor,
  bandFor,
  modifierOf,
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
import { PendingRollService } from './pending-roll.service.js';
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
    private readonly pending: PendingRollService,
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
    let said = '';

    /*
      Second temps d'une action que le de tranche. Tout a deja ete decide au
      premier : la moderation a tourne, la limite a ete consommee, et la
      situation vient de Redis et non du navigateur.
    */
    if (request.kind === 'roll') {
      const pending = await this.pending.take(user.id);
      if (!pending) {
        throw new HttpException({ code: 'roll_expired' }, HttpStatus.CONFLICT);
      }
      said = pending.content;
      situation = pending.situation;
      locale = pending.locale;
    }

    // Avant la limite et avant tout appel : un message refuse ne doit ni
    // consommer un tour, ni atteindre le modele, ni entrer en base.
    if (request.kind === 'say' || request.kind === 'ask') {
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

    const verdict =
      request.kind === 'roll'
        ? { allowed: true }
        : await this.limits.consume(user.id);
    if (!verdict.allowed) {
      res.setHeader('Retry-After', String(verdict.retryAfterSeconds ?? 60));
      throw new HttpException(
        { code: 'rate_limited', retryAfterSeconds: verdict.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const fate = request.kind === 'fate';
    const opening = request.kind === 'open';
    const asking = request.kind === 'ask';
    if (request.kind === 'say' || asking) said = request.content;

    /*
      Une question ne se tranche pas au de : le joueur ne tente rien. Elle
      annule aussi ce qui attendait un jet, comme n'importe quelle autre
      chose que le joueur decide de faire a la place.
    */
    if (asking) await this.pending.drop(user.id);

    /*
      Premier temps : l'action se tranche au de, donc rien n'est genere et
      rien n'est debite. Ce que le joueur a ecrit attend en Redis, et l'ecran
      lui demande le jet.
    */
    if (request.kind === 'say' && settledByDie(situation)) {
      await this.pending.hold(user.id, {
        content: said,
        situation: situation!,
        locale,
      });
      this.openStream(res);
      this.write(res, { type: 'roll_required' });
      res.end();
      return;
    }

    // Une action qui ne se tranche pas annule celle qui attendait son jet.
    if (request.kind === 'say') await this.pending.drop(user.id);

    // Debit avant tout appel : une reserve vide refuse le tour sans rien
    // depenser, et le joueur n'a pas de facture surprise.
    let debit: string | null = null;
    try {
      debit = await this.credits.spend(
        asking ? ('question' as const) : ('turn' as const),
        user.id,
        world.universeId,
      );
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
    /*
      Le de a-t-il tranche ? C'est le code qui repond, pas le modele.

      Il declare bien `usedDie` dans son bloc de queue, mais il l'oublie ou le
      nie : sur les premiers tours, `used_die` etait faux meme la ou le joueur
      venait de lancer. Or ce qu'on montre au joueur et ce qu'on garde pour
      verifier un de apres coup ne peuvent pas dependre d'une declaration.
      Sa reponse ne sert donc plus que pour les tours qu'on lui laisse juger.
    */
    const settled = !opening && !asking && settledByDie(situation);

    const die = rollD20();

    /*
      Ce que la fiche pese sur ce jet. L'attribut vient de la situation, donc
      du code : demander au modele lequel s'applique reviendrait a le laisser
      choisir le plus haut.

      Hors d'un jet tranche, le modificateur reste nul : le meneur juge alors
      lui-meme de l'incertitude, et melanger sa liberte avec le socle du
      personnage rendrait le resultat illisible.
    */
    const attribute = settled ? attributeFor(situation) : null;
    const modifier = attribute ? modifierOf(world.character.attributes[attribute]) : 0;
    const band = bandFor(die, modifier);


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

    // Le joueur a lance : il voit son chiffre, avant que le recit commence.
    if (request.kind === 'roll') {
      this.write(res, {
        type: 'roll',
        die,
        modifier,
        attribute,
        outcome: publicOutcome(band),
      });
    }

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
          asking,
          mustUseDie: settled,
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
      /*
        Les oeuvres du joueur, et non un tableau vide : c'est le troisieme
        etage de la garde sur les emprunts, et il ne comparait contre rien.
        Le canon nourrit tous les tours suivants, donc un nom qui entre ici
        ne ressort plus.
      */
      const arbitrated = arbitrateCanon(delta.facts, world.charter, world.works);
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
            modifier,
            attribute,
            usedDie: settled || delta.usedDie,
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
          outcome: settled || delta.usedDie ? publicOutcome(band) : null,
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
