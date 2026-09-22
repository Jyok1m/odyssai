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
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CanonFactSchema,
  INVENTORY_MAX,
  entityKey,
  type Entity,
  TurnRequestSchema,
  type Situation,
  type TurnHistory,
  type TurnStreamEvent,
} from '@odyssai/schemas';
import type { LlmClient } from '@odyssai/llm';
import {
  GUIDANCE,
  LORE_PROMPT_VERSION,
  TURN_PROMPT_VERSION,
  describeEntity,
  playTurn,
} from '@odyssai/narrator';
import {
  arbitrateCanon,
  attributeFor,
  bandFor,
  grewTo,
  modifierOf,
  publicOutcome,
  rollD20,
  settledByDie,
  usesAfter,
  carryAfter,
  revealLore,
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
    const world = await this.memory.world(user);
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
      inventory: world.inventory,
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

    const request = parsed.data;

    const world = await this.memory.world(user);
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
      /*
        Le message precedent situe un message court : « Je retente ! » n'a
        pas de situation a lui, et un 20 naturel s'est perdu la-dessus.
      */
      const previous = await this.prisma.conversationMessage.findFirst({
        where: { universeId: world.universeId, channel: CHANNEL, role: 'user' },
        orderBy: { seq: 'desc' },
        select: { content: true },
      });
      const seen = await this.moderation.check(
        request.content,
        user.locale,
        user.id,
        previous?.content,
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
    // Une question n'est pas une scene : un rappel de maitrise y ferait
    // avancer ce qui ne doit pas bouger, et c'est ce qui s'est vu.
    const guidance = asking ? [] : GUIDANCE.for(situation, locale);

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
    const score = attribute ? world.character.attributes[attribute] : 0;
    const modifier = attribute ? modifierOf(score) : 0;
    const band = bandFor(die, modifier);

    /*
      On progresse en pratiquant : le jet compte pour l'attribut qu'il
      sollicite, echec compris. Rater est la facon la plus ordinaire
      d'apprendre, et ne compter que les reussites ferait monter le plus fort
      et stagner le plus faible.
    */
    const uses = attribute ? usesAfter(world.progress, attribute) : 0;
    const grew = attribute ? grewTo(score, uses) : null;


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
        config: this.config.modelFor('turn'),
        locale,
        context: {
          ...world,
          ...memory,
          band,
          fate,
          opening,
          guidance: guidance.map((card) => card.text),
          inventory: world.inventory,
          arc: world.bible.arc,
          act: world.act ?? undefined,
          entities: world.entities,
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

      /*
        Ce que le modele dit avoir change de main, applique par le code : un
        objet qu'il n'a pas declare ici n'entre pas, quoi que son recit ait
        raconte.
      */
      /*
        L'acte avance d'un cran au plus, et ne recule jamais : le modele
        declare, le code borne. Au dela du dernier, la partie passe en
        aventure libre et n'en sort plus.
      */
      const acts = world.bible.arc?.acts.length ?? 0;
      const act =
        world.act !== null && delta.actDone && world.act <= acts
          ? world.act + 1
          : null;

      /*
        Le lore qui grandit. Chaque nom nouveau declare par le meneur recoit
        son fragment, coherent avec le monde, et le paie : un credit par
        entite. Sans reserve, l'entite reste sans histoire et le tour se joue
        quand meme. Les revelations, elles, ne coutent rien : le cache rejoint
        le su, c'est tout.
      */
      const born: Entity[] = [];
      const known = new Set(world.entities.map((entity) => entityKey(entity.name)));
      for (const candidate of delta.met) {
        const key = entityKey(candidate.name);
        if (known.has(key)) continue;

        let loreDebit: string | null = null;
        try {
          loreDebit = await this.credits.spend('lore' as const, user.id, world.universeId);
        } catch (error: unknown) {
          if (error instanceof OutOfCreditsError) {
            this.logger.log(`reserve vide : ${candidate.name} reste sans lore`);
            continue;
          }
          throw error;
        }

        const described = await describeEntity({
          llm: this.llm,
          config: this.config.modelFor('lore'),
          locale,
          works: world.works,
          context: {
            charter: world.charter,
            lore: world.bible.lore,
            factions: world.bible.factions.map((faction) => faction.name),
            existing: world.entities.map((entity) => entity.name),
            goal:
              world.act && world.bible.arc && world.act <= world.bible.arc.acts.length
                ? world.bible.arc.acts[world.act - 1]!.goal
                : undefined,
            entity: candidate,
          },
          trace: {
            name: 'lore',
            metadata: {
              turn_id: turnId,
              universe_id: world.universeId,
              prompt_version: LORE_PROMPT_VERSION,
              entity: candidate.name,
            },
          },
        });

        await this.usage.record({
          kind: 'lore',
          provider: this.config.provider,
          userId: user.id,
          universeId: world.universeId,
          usage: described.usage,
          prices: this.config.prices,
        });

        if (described.kind !== 'ok') {
          this.logger.warn(`lore refuse (${described.reason}) : ${candidate.name}`);
          if (loreDebit) await this.credits.refund(loreDebit);
          continue;
        }

        known.add(key);
        born.push({
          name: candidate.name,
          kind: candidate.kind,
          known: described.fragment.known,
          hidden: described.fragment.hidden,
        });
      }

      // Le cache sort : une revelation ne se defait pas.
      const revealedKeys = new Set(delta.revealed.map(entityKey));
      const revealed = world.entities.filter(
        (entity) => entity.hidden && revealedKeys.has(entityKey(entity.name)),
      );

      const carried = carryAfter(
        world.inventory,
        delta.gained,
        delta.lost,
        INVENTORY_MAX,
      );
      const moved =
        carried.length !== world.inventory.length ||
        carried.some((item, index) => item !== world.inventory[index]);
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
        ...born.map((entity) =>
          this.prisma.entity.create({
            data: {
              universeId: world.universeId,
              kind: entity.kind,
              name: entity.name,
              key: entityKey(entity.name),
              known: entity.known,
              hidden: entity.hidden,
              seq,
            },
          }),
        ),
        ...revealed.map((entity) =>
          this.prisma.entity.update({
            where: {
              universeId_key: { universeId: world.universeId, key: entityKey(entity.name) },
            },
            data: { ...revealLore(entity), revealedAt: new Date() },
          }),
        ),
        ...(act
          ? [
              this.prisma.universe.update({
                where: { id: world.universeId },
                data: { arcAct: act },
              }),
            ]
          : []),
        this.prisma.turn.create({
          data: {
            universeId: world.universeId,
            seq,
            // Ce que le joueur a envoye, pour diagnostiquer : le `kind` du
            // delta est ce que le modele en a fait, pas ce qui est arrive.
            request: request.kind,
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
            model: usage.model ?? this.config.modelFor('turn').model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd: UsageService.cost(usage, this.config.prices),
            traceId: turnId,
          },
        }),
        ...(!attribute && moved
          ? [
              this.prisma.character.update({
                where: { universeId: world.universeId },
                data: { inventory: carried },
              }),
            ]
          : []),
        ...(attribute
          ? [
              this.prisma.character.update({
                where: { universeId: world.universeId },
                data: {
                  progress: { ...world.progress, [attribute]: grew ? 0 : uses },
                  ...(moved ? { inventory: carried } : {}),
                  ...(grew
                    ? {
                        attributes: {
                          ...world.character.attributes,
                          [attribute]: grew,
                        },
                      }
                    : {}),
                },
              }),
            ]
          : []),
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
        for (const entity of [...born, ...revealed.map(revealLore)]) {
          this.write(res, {
            type: 'lore',
            name: entity.name,
            kind: entity.kind,
            known: entity.known,
          });
        }
      }

      if (streaming && moved) {
        this.write(res, { type: 'carrying', items: carried });
      }

      if (streaming && grew && attribute) {
        this.write(res, { type: 'grew', attribute, score: grew });
      }

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
