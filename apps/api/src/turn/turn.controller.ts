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
  AttributeSchema,
  TurnRequestKindSchema,
  INVENTORY_MAX,
  entityKey,
  type Entity,
  TurnRequestSchema,
  type Mark,
  type ScenePresence,
  type Situation,
  type TurnHistory,
  type TurnStreamEvent,
} from '@odyssai/schemas';
import type { LlmClient } from '@odyssai/llm';
import {
  DIALOGUE_PROMPT_VERSION,
  GUIDANCE,
  LORE_PROMPT_VERSION,
  MARK_PROMPT_VERSION,
  PARTY_TURN_PROMPT_VERSION,
  TURN_PROMPT_VERSION,
  describeEntity,
  describeMark,
  playPartyTurn,
  playTurn,
  speakLine,
} from '@odyssai/narrator';
import {
  PROGRESS_STEPS,
  arbitrateCanon,
  conditionOf,
  harmFor,
  hpMaxOf,
  markFor,
  marksAfter,
  vitalsAfter,
  attributeFor,
  bandFor,
  grewTo,
  modifierOf,
  presentIn,
  publicOutcome,
  rollD20,
  settledByDie,
  usesAfter,
  carryAfter,
  revealLore,
  interlocutorOf,
} from '@odyssai/engine';
import { PrismaClient, type User } from '@odyssai/db';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { AlphaOpenGuard } from '../alpha/alpha-open.guard.js';
import { NarratorConfig } from '../config/narrator-config.js';
import { NARRATOR_LLM } from '../onboarding/narrator-llm.provider.js';
import { PRISMA } from '../prisma/prisma.module.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { TurnLimitsService } from './turn-limits.service.js';
import { TurnLockService } from './turn-lock.service.js';
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
// L'ordre compte : le second relit le joueur que le premier depose.
@UseGuards(SessionGuard, AlphaOpenGuard)
export class TurnController {
  private readonly logger = new Logger(TurnController.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(NARRATOR_LLM) private readonly llm: LlmClient,
    private readonly config: NarratorConfig,
    private readonly memory: TurnMemoryService,
    private readonly limits: TurnLimitsService,
    private readonly locks: TurnLockService,
    private readonly pending: PendingRollService,
    private readonly moderation: ModerationService,
    private readonly usage: UsageService,
    private readonly credits: CreditsService,
  ) {}

  @Get()
  async history(@CurrentUser() user: User): Promise<TurnHistory> {
    const world = await this.memory.world(user);
    if (!world) throw new NotFoundException({ code: 'not_ready' });

    /*
      Dans une table, le journal se lit comme une conversation de groupe :
      le nom du personnage au-dessus de chaque message de joueur. Une
      histoire solo n'en a pas besoin, il n'y a qu'une voix.
    */
    const authors = world.party
      ? new Map(
          (
            await this.prisma.character.findMany({
              where: { universeId: world.universeId, ownerId: { in: world.party.members } },
              select: { ownerId: true, name: true },
            })
          ).flatMap((row) =>
            row.ownerId && row.name ? [[row.ownerId, row.name] as const] : [],
          ),
        )
      : null;

    const [messages, turns, rolled] = await Promise.all([
      this.prisma.conversationMessage.findMany({
        where: { universeId: world.universeId, channel: CHANNEL },
        orderBy: { seq: 'asc' },
      }),
      this.prisma.turn.findMany({
        where: { universeId: world.universeId },
      }),
      /*
        Le dernier jet que le joueur a lui-meme lance. `request` et non
        `used_die` : le de tourne a chaque tour, mais le joueur n'en voit le
        chiffre que quand c'est lui qui l'a demande, et la declaration du
        modele ne dit pas ce qui s'est passe. Dans une table, le sien : le
        jet d'un autre est le sien a lui.
      */
      this.prisma.turn.findFirst({
        where: {
          universeId: world.universeId,
          request: 'roll',
          ...(world.party ? { memberId: user.id } : {}),
        },
        orderBy: { seq: 'desc' },
        select: { die: true, modifier: true, attribute: true, band: true },
      }),
    ]);

    // L'issue est portee par la reponse du meneur, dont le rang suit celui du
    // message qui l'a provoquee. Et seulement quand le de a servi.
    const outcomes = new Map(
      turns
        .filter((turn) => turn.usedDie)
        .map((turn) => [turn.seq + 1, publicOutcome(turn.band as never)]),
    );
    /*
      Ce que le joueur a envoye, sur son message et sur la reponse. Le rang
      du tour est celui du message du joueur, sauf a l'ouverture, ou il n'y
      en a pas et ou la reponse prend le rang elle-meme.
    */
    const requests = new Map<number, string | null>();
    for (const turn of turns) {
      requests.set(turn.seq, turn.request);
      if (turn.request !== 'open') requests.set(turn.seq + 1, turn.request);
    }

    return {
      inventory: world.inventory,
      messages: messages.map((row) => ({
        id: row.id,
        seq: row.seq,
        role: row.role,
        content: row.content,
        author: row.memberId ? (authors?.get(row.memberId) ?? null) : null,
        outcome: outcomes.get(row.seq) ?? null,
        request: TurnRequestKindSchema.nullable().catch(null).parse(requests.get(row.seq) ?? null),
        createdAt: row.createdAt.toISOString(),
      })),
      /*
        Ce que le meneur a nomme a sa derniere reponse. Relu ici plutot que
        garde en base : c'est une lecture du recit, elle se refait a
        l'identique et ne peut pas deriver de lui.
      */
      scene: scenePresence(
        [...messages].reverse().find((row) => row.role === 'assistant')?.content ?? '',
        world.entities,
      ),
      lastRoll: rolled
        ? {
            die: rolled.die,
            modifier: rolled.modifier,
            attribute: AttributeSchema.nullable().catch(null).parse(rolled.attribute),
            outcome: publicOutcome(rolled.band as never),
          }
        : null,
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

    /*
      Une narration a la fois par histoire. Pris avant le debit : un tour
      refuse n'a rien paye. Le meneur ne raconte qu'une scene, le journal
      n'a qu'un rang suivant, et deux tours simultanes se marcheraient
      dessus, deux onglets du meme joueur hier, deux joueurs d'une table
      aujourd'hui.

      Le verrou expire seul : un processus mort ne ferme pas la table.
    */
    const token = await this.locks.acquire(world.universeId);
    if (!token) {
      throw new HttpException({ code: 'busy' }, HttpStatus.CONFLICT);
    }

    try {
      /*
        Dans une table, le tour de l'un fait avancer la scene : ce que les
        autres attendaient en travers d'un jet ne peut plus s'y poser telle
        quelle. Ils reecriront, et rien de ce qui attendait n'est perdu, rien
        n'ayant ete debite ni ecrit.
      */
      if (world.party) {
        await this.pending.dropAll(
          world.party.members.filter((member) => member !== user.id),
        );
      }

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

      const memory = await this.memory.recall(world, said);
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

        Il le declarait dans son bloc de queue et se trompait dans les deux
        sens : faux la ou le joueur venait de lancer, vrai sur une simple
        question, ce qui affichait un verdict sous une question. Ce qu'on
        montre au joueur et ce qu'on garde pour verifier un de apres coup ne
        dependent d'aucune declaration : sur un tour qu'on lui laisse juger, la
        bande peut colorer son recit, mais rien ne s'affiche.
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

      /*
        Ce que l'echange coute.

        Le de decide, comme il decide du reste : le meneur ne declare aucun
        degat, donc il ne peut ni epargner un joueur qui insiste, ni l'achever
        pour la beaute de la scene. Seules les situations physiques blessent, et
        seulement quand le de a tranche.
      */
      const harm = settled ? harmFor(situation, band) : 0;

      /*
        Un cran de `corps` gagne rend le personnage plus dur, et lui rend les
        points correspondants : sans cela il se retrouverait « blesse » pour
        avoir progresse, sa reserve ayant grandi sous lui.
      */
      const hpMax = grew && attribute === 'corps' ? hpMaxOf(grew) : world.health.hpMax;
      const vitals = vitalsAfter(
        {
          hp: world.health.hp + (hpMax - world.health.hpMax),
          rest: world.health.rest,
        },
        hpMax,
        harm,
      );

      /*
        L'etat que le meneur recoit est celui de la fin de sa scene : il a deja
        la bande, donc lui cacher le coup qu'elle implique l'obligerait a le
        narrer sans le savoir.
      */
      const condition = conditionOf(vitals.hp, hpMax);
      const healthMoved =
        vitals.hp !== world.health.hp ||
        vitals.rest !== world.health.rest ||
        hpMax !== world.health.hpMax;


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
            // Dans une table, qui a parle : la reponse du meneur est celle du
            // groupe, le message de joueur ne l'est jamais.
            memberId: world.party ? user.id : null,
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

      /*
        A qui le joueur parle, si c'est a quelqu'un : ce personnage repond par
        le modele de jeu de role, et le meneur rend sa replique telle quelle.
        Le code choisit l'interlocuteur, jamais le modele. Un echec ici ne
        coute rien au tour : le meneur fait parler le personnage lui-meme,
        comme avant.
      */
      const speaker =
        opening || asking || fate
          ? null
          : interlocutorOf({
              message: said,
              situation,
              entities: world.entities,
              recent: memory.recent,
            });
      let line: { speaker: string; text: string } | null = null;

      if (speaker) {
        try {
          await this.credits.spend('dialogue', user.id, world.universeId);
          const spoken = await speakLine({
            llm: this.llm,
            config: this.config.modelFor('dialogue'),
            context: {
              charter: world.charter,
              npc: speaker,
              player: world.character.name,
              locale,
              recent: memory.recent,
            },
            message: said,
            works: world.works,
            trace: {
              name: 'dialogue',
              metadata: {
                turn_id: turnId,
                universe_id: world.universeId,
                prompt_version: DIALOGUE_PROMPT_VERSION,
                speaker: speaker.name,
              },
            },
          });

          await this.usage.record({
            kind: 'dialogue',
            provider: this.config.provider,
            userId: user.id,
            universeId: world.universeId,
            usage: spoken.usage,
            prices: this.config.prices,
          });

          // Relue par la couche lexicale, comme la reponse du meneur : une
          // replique refusee est une replique absente, jamais un tour perdu.
          if (spoken.kind === 'ok' && this.moderation.clean(spoken.line)) {
            line = { speaker: speaker.name, text: spoken.line };
          } else {
            this.logger.log(
              `replique de ${speaker.name} ecartee (${spoken.kind === 'ok' ? 'moderation' : spoken.reason})`,
            );
          }
        } catch (error: unknown) {
          this.logger.warn(`replique de ${speaker.name} en echec : ${String(error)}`);
        }
      }

      try {
        /*
          La table a son prompt, le solo le sien : les regles se disent
          autrement pour un groupe, et ce qui est mesure pour le joueur seul
          ne se recrit pas pour lui. Le contexte, lui, est le meme : la fiche
          est celle du joueur actif, le monde celui de la table.
        */
        const base = {
          ...world,
          ...memory,
          band,
          fate,
          opening,
          guidance: guidance.map((card) => card.text),
          inventory: world.inventory,
          condition,
          arc: world.bible.arc,
          act: world.act ?? undefined,
          entities: world.entities,
          // Une ouverture ne tranche rien : le joueur n'a encore rien tente.
          asking,
          mustUseDie: settled,
          line: line ?? undefined,
        };

        const message = fate ? "Je ne sais pas quoi faire, que le sort decide." : said;

        const turn = world.party
          ? playPartyTurn({
              llm: this.llm,
              config: this.config.modelFor('turn'),
              locale,
              context: { ...base, party: { actors: world.party.actors } },
              message,
              trace: {
                name: 'turn',
                metadata: {
                  turn_id: turnId,
                  universe_id: world.universeId,
                  prompt_version: PARTY_TURN_PROMPT_VERSION,
                  band,
                  situation,
                },
              },
            })
          : playTurn({
              llm: this.llm,
              config: this.config.modelFor('turn'),
              locale,
              context: base,
              message,
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

        /*
          Ce que ce tour laisse au personnage.

          Le declencheur est du code : il vient de tomber, ou un acte vient de
          s'achever. Le modele n'ecrit que la ligne, et jamais le genre : une
          marque qu'il accorderait finirait par s'accorder a celui qui la
          demande, comme la montee d'attribut.
        */
        let mark: Mark | null = null;
        const kind = world.essence
          ? markFor({
              fell: vitals.hp === 0 && world.health.hp > 0,
              actClosed: act !== null,
              marks: world.essence.marks.length,
            })
          : null;

        if (kind && world.essence) {
          let markDebit: string | null = null;
          try {
            markDebit = await this.credits.spend('mark', user.id, world.universeId);

            const written = await describeMark({
              llm: this.llm,
              config: this.config.modelFor('mark'),
              locale,
              works: world.works,
              context: {
                charter: world.charter,
                world: world.bible.lore.name,
                kind,
                scene: answer,
                existing: world.essence.marks.map((worn) => worn.text),
              },
              trace: {
                name: 'mark',
                metadata: {
                  turn_id: turnId,
                  universe_id: world.universeId,
                  prompt_version: MARK_PROMPT_VERSION,
                  mark_kind: kind,
                },
              },
            });

            await this.usage.record({
              kind: 'mark',
              provider: this.config.provider,
              userId: user.id,
              universeId: world.universeId,
              usage: written.usage,
              prices: this.config.prices,
            });

            // Relue par la couche lexicale comme le reste : une marque refusee
            // est une marque absente, jamais un tour perdu.
            if (written.kind === 'ok' && this.moderation.clean(written.text)) {
              mark = {
                kind,
                world: world.bible.lore.name,
                text: written.text,
                at: new Date().toISOString(),
              };
            } else {
              this.logger.warn(`marque refusee au tour ${seq}`);
              if (markDebit) await this.credits.refund(markDebit);
            }
          } catch (error: unknown) {
            if (error instanceof OutOfCreditsError) {
              this.logger.log('reserve vide : le tour ne laisse pas de marque');
            } else {
              this.logger.warn(`marque en echec : ${String(error)}`);
              if (markDebit) await this.credits.refund(markDebit);
            }
          }
        }

        const carried = carryAfter(
          world.inventory,
          delta.gained,
          delta.lost,
          INVENTORY_MAX,
        );
        const moved =
          carried.length !== world.inventory.length ||
          carried.some((item, index) => item !== world.inventory[index]);

        /*
          Tout ce qui bouge sur la fiche, en une seule ecriture.

          C'etaient deux branches conditionnelles, l'une pour l'inventaire et
          l'autre pour la progression, et la sante en aurait fait une troisieme :
          trois mises a jour de la meme ligne dans la meme transaction, chacune
          devant se souvenir de ce que les autres ecrivent.
        */
        const sheet = {
          ...(moved ? { inventory: carried } : {}),
          ...(attribute
            ? { progress: { ...world.progress, [attribute]: grew ? 0 : uses } }
            : {}),
          ...(grew && attribute
            ? { attributes: { ...world.character.attributes, [attribute]: grew } }
            : {}),
          ...(healthMoved ? { hp: vitals.hp, rest: vitals.rest } : {}),
        };

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
          /*
            Une revelation s'ecrit toujours du cote de l'histoire, jamais du
            monde qu'elle lit : en visite, ce que le joueur apprend d'un habitant
            de l'hote entre dans son propre codex, et l'hote n'en sait rien.
            C'est une projection, et c'est la seule facon de garder la regle
            « un univers n'ecrit jamais dans l'etat d'un autre ».

            Un upsert, donc, et non une mise a jour : chez soi la ligne existe
            deja, en visite elle est a creer.
          */
          ...revealed.map((entity) => {
            const shown = revealLore(entity);
            const key = entityKey(entity.name);

            return this.prisma.entity.upsert({
              where: { universeId_key: { universeId: world.universeId, key } },
              update: { ...shown, revealedAt: new Date() },
              create: {
                universeId: world.universeId,
                kind: shown.kind,
                name: shown.name,
                key,
                known: shown.known,
                hidden: shown.hidden,
                revealedAt: new Date(),
                seq,
              },
            });
          }),
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
              usedDie: settled,
              kind: delta.kind,
              learned: arbitrated.accepted.length,
              situation,
              guidance: guidance.map((card) => card.id),
              speaker: line?.speaker ?? null,
              line: line?.text ?? null,
              provider: this.config.provider,
              model: usage.model ?? this.config.modelFor('turn').model,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              costUsd: UsageService.cost(usage, this.config.prices),
              traceId: turnId,
            },
          }),
          ...(Object.keys(sheet).length > 0 && world.characterId
            ? [
                this.prisma.character.update({
                  where: { id: world.characterId },
                  data: sheet,
                }),
              ]
            : []),
          /*
            La marque va sur l'essence et non sur l'incarnation : c'est ce qui
            traverse, et c'est tout l'interet d'en garder une.
          */
          ...(mark && world.essence
            ? [
                this.prisma.essence.update({
                  where: { id: world.essence.id },
                  data: { marks: marksAfter(world.essence.marks, mark) },
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

        /*
          Qui se tient dans la scene, relu dans ce que le meneur vient d'ecrire.
          Les entites nees a ce tour en font partie : elles viennent d'y etre
          nommees, c'est meme ce qui les a fait naitre.
        */
        if (streaming) {
          this.write(res, {
            type: 'scene',
            present: scenePresence(answer, [...world.entities, ...born]),
          });
        }

        /*
          La jauge, avant l'inventaire : un coup recu se lit avant ce qu'on a
          ramasse. Le joueur voit le chiffre, le meneur n'a eu qu'un mot.
        */
        if (streaming && healthMoved) {
          this.write(res, {
            type: 'health',
            hp: vitals.hp,
            hpMax,
            condition,
            harm,
          });
        }

        if (streaming && moved) {
          // Ce qui n'y etait pas avant ce tour. `carryAfter` a deja ecarte les
          // doublons et les objets refuses : la comparaison porte sur ce qui
          // est reellement entre, pas sur ce que le modele a declare.
          const before = new Set(world.inventory.map(entityKey));
          this.write(res, {
            type: 'carrying',
            items: carried,
            gained: carried.filter((item) => !before.has(entityKey(item))),
          });
        }

        if (streaming && mark) {
          this.write(res, { type: 'mark', kind: mark.kind, text: mark.text });
        }

        if (streaming && grew && attribute) {
          this.write(res, {
            type: 'grew',
            attribute,
            score: grew,
            modifier: modifierOf(grew),
            needed: PROGRESS_STEPS[grew] ?? null,
          });
        }

        if (streaming) {
          this.write(res, {
            type: 'done',
            outcome: settled ? publicOutcome(band) : null,
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
    } finally {
      // Le creneau de narration se rend, toujours : un tour qui rend la
      // main ferme la porte qu il a ouverte, et un tour en echec aussi.
      await this.locks.release(world.universeId, token);
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

/*
  Qui et quoi se tient dans une scene, pour l'ecran.

  Les personnages et les lieux seulement : un objet nomme au passage n'est pas
  une presence, il est dans l'inventaire ou il ne l'est pas.
*/
function scenePresence(narration: string, entities: Entity[]): ScenePresence[] {
  return presentIn(narration, entities)
    .filter((entity) => entity.kind === 'npc' || entity.kind === 'place')
    .map((entity) => ({ name: entity.name, kind: entity.kind }));
}
