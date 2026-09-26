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
  ATTRIBUTES,
  AttributesSchema,
  CanonFactSchema,
  MarksSchema,
  PartySchema,
  WorldBibleSchema,
  WorldCharterSchema,
  WorldViewSchema,
  type Attribute,
  type AttributeStanding,
  type GenerationStreamEvent,
  type Party,
  type WorldView,
} from '@odyssai/schemas';
import { PROGRESS_STEPS, conditionOf, hpMaxOf, modifierOf } from '@odyssai/engine';
import { PrismaClient, type User } from '@odyssai/db';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { AlphaOpenGuard } from '../alpha/alpha-open.guard.js';
import { PRISMA } from '../prisma/prisma.module.js';
import { openStoryWhere } from '../stories/stories.service.js';
import { GenerationRefundService } from './generation-refund.service.js';

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
// L'ordre compte : le second relit le joueur que le premier depose.
@UseGuards(SessionGuard, AlphaOpenGuard)
export class GenerationController {
  private readonly logger = new Logger(GenerationController.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly refunds: GenerationRefundService,
  ) {}

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
    const where = openStoryWhere(user);

    try {
      while (open && Date.now() < deadline) {
        const universe = where
          ? await this.prisma.universe.findFirst({
              where,
              select: {
                id: true,
                step: true,
                name: true,
                jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
              },
            })
          : null;

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
          // Une generation qui echoue ne doit rien couter : le joueur n'a pas
          // eu son monde. Idempotent, deux lectures ne creditent pas deux fois.
          await this.refunds.settle(universe.id);
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
    const where = openStoryWhere(user);
    const universe = where
      ? await this.prisma.universe.findFirst({
          where,
          include: {
            /*
              Sa fiche, et lui seul : une histoire solo en porte une, une
              table une par membre, et le filtre rend toujours la sienne.
            */
            characters: {
              where: { ownerId: user.id },
              include: { essence: { select: { marks: true } } },
            },
            entities: { orderBy: { createdAt: 'asc' } },
            canon: { orderBy: { createdAt: 'asc' } },
            party: {
              include: {
                members: {
                  orderBy: { joinedAt: 'asc' },
                  include: { user: { select: { username: true } } },
                },
              },
            },
            /*
              Le monde visite, quand il y en a un : c'est le sien qu'on rend,
              avec ce que cette histoire y a decouvert par-dessus.
            */
            visiting: {
              include: {
                entities: { orderBy: { createdAt: 'asc' } },
                canon: { orderBy: { createdAt: 'asc' } },
              },
            },
          },
        })
      : null;

    if (!universe) throw new NotFoundException({ code: 'not_found' });
    if (universe.step !== 'ready') {
      throw new NotFoundException({ code: 'not_ready' });
    }

    // La source : le monde visite s'il y en a un, le sien sinon.
    const source = universe.visiting ?? universe;

    const charter = WorldCharterSchema.safeParse(source.charter);
    const bible = WorldBibleSchema.safeParse(source.bible);
    if (!charter.success || !bible.success) {
      // L'etape dit `ready` mais le contenu ne tient pas : c'est un defaut de
      // notre cote, pas une demande invalide.
      this.logger.error(`monde ${universe.id} illisible malgre l'etape ready`);
      throw new NotFoundException({ code: 'not_ready' });
    }

    const played = universe.characters[0] ?? null;

    const attributes = AttributesSchema.safeParse(played?.attributes);
    if (!attributes.success) {
      // Le meme constat que plus haut : la fiche est illisible, donc la
      // partie l'est aussi, `TurnMemoryService` la relisant a chaque tour.
      this.logger.error(`fiche de ${universe.id} illisible malgre l'etape ready`);
      throw new NotFoundException({ code: 'not_ready' });
    }

    const progress = (played?.progress ?? {}) as Record<string, unknown>;

    /*
      La reserve derive de `corps`, et `hp` nul en base vaut la reserve
      pleine : rien n'a encore entame ce personnage.
    */
    const hpMax = hpMaxOf(attributes.data.corps);
    const hp = played?.hp ?? hpMax;

    /*
      Les autres mondes ou la meme essence s'est posee. Vide pour un
      personnage qui n'a jamais franchi de faille, et c'est le cas ordinaire :
      la requete ne part meme pas.
    */
    const essenceId = played?.essenceId ?? null;
    const elsewhere = essenceId
      ? await this.prisma.character.findMany({
          where: {
            essenceId,
            universeId: { not: universe.id },
            universe: { ownerId: user.id },
          },
          select: {
            arrival: true,
            universe: {
              select: { id: true, name: true, step: true, accentHue: true },
            },
          },
        })
      : [];

    // Le schema de vue laisse tomber les secrets des personnages : ils se
    // decouvriront en jeu, et un champ qu'un type ne porte pas ne fuite pas.
    return WorldViewSchema.parse({
      name: bible.data.lore.name,
      accentHue: bible.data.lore.accentHue,
      charter: charter.data,
      lore: bible.data.lore,
      factions: bible.data.factions,
      politics: bible.data.politics,
      npcs: bible.data.npcs,
      affinities: bible.data.affinities,
      // Le su seulement : le schema de vue ne porte pas le cache.
      entities: [...(universe.visiting?.entities ?? []), ...universe.entities].map(
        (row) => ({
          name: row.name,
          kind: row.kind,
          known: row.known,
        }),
      ),
      /*
        Un fait illisible est saute plutot que de faire echouer la lecture du
        monde : le canon grandit tour apres tour, et une ligne fautive ne doit
        pas fermer la partie.
      */
      canon: [...(universe.visiting?.canon ?? []), ...universe.canon].flatMap((row) => {
        const parsed = CanonFactSchema.safeParse({
          subject: row.subject,
          statement: row.statement,
        });
        return parsed.success ? [parsed.data] : [];
      }),
      /*
        Le rang de l'acte et rien d'autre. Le but de l'acte en cours et son
        signe de fin restent au meneur : le joueur qui les lirait n'aurait
        plus qu'a y aller.
      */
      /*
        L'arc appartient a l'histoire, pas au monde : un visiteur n'herite pas
        de celle de son hote, et n'en voit donc aucun acte.
      */
      story: {
        act: universe.visiting ? null : universe.arcAct,
        acts: universe.visiting ? 0 : (bible.data.arc?.acts.length ?? 0),
        /*
          Le titre de l'acte en cours, et lui seul. Au dela du dernier, la
          partie est en aventure libre : il n'y a plus d'acte a nommer.
        */
        title:
          !universe.visiting &&
          universe.arcAct &&
          universe.arcAct <= (bible.data.arc?.acts.length ?? 0)
            ? (bible.data.arc?.acts[universe.arcAct - 1]?.title ?? null)
            : null,
        bond: universe.visiting ? null : (bible.data.arc?.hero?.bond ?? null),
      },
      /*
        La table, quand ce monde se joue a plusieurs : l'ecran s'en sert
        pour rafraichir le journal pendant que d'autres jouent, et pour
        montrer qui est assis.
      */
      party: universe.party
        ? await this.partyBlock(user.id, universe.party, universe.id)
        : null,
      character: {
        name: played?.name,
        gender: played?.gender,
        age: played?.age,
        personality: played?.personality,
        attributes: attributes.data,
        standing: standingOf(attributes.data, progress),
        health: { hp, hpMax, condition: conditionOf(hp, hpMax) },
        talents: played?.talents ?? [],
        inventory: played?.inventory ?? [],
        arrival: played?.arrival ?? 'natif',
        /*
          Des marques illisibles valent une liste vide : elles decorent une
          fiche, elles ne doivent pas l'empecher de s'ouvrir.
        */
        marks: MarksSchema.catch([]).parse(played?.essence?.marks ?? []),
        elsewhere: elsewhere.flatMap((row) =>
          row.universe
            ? [
                {
                  universeId: row.universe.id,
                  world: row.universe.name,
                  step: row.universe.step,
                  arrival: row.arrival,
                  accentHue: row.universe.accentHue,
                  current: row.universe.id === user.currentUniverseId,
                },
              ]
            : [],
        ),
      },
    });
  }

  /*
    La table pour la vue du monde. Le contrat est celui de PartySchema, un
    seul pour le parcours et pour la table ; les noms de personnages y
    remplacent les pseudos, le joueur joue des personnages.
  */
  private async partyBlock(
    userId: string,
    party: {
      id: string;
      size: number;
      inviteCode: string;
      members: {
        userId: string;
        isHost: boolean;
        ready: boolean;
        user: { username: string | null };
      }[];
    },
    universeId: string,
  ): Promise<Party> {
    const names = await this.prisma.character.findMany({
      where: { universeId },
      select: { ownerId: true, name: true },
    });
    const byOwner = new Map(
      names.flatMap((row) =>
        row.ownerId && row.name ? [[row.ownerId, row.name] as const] : [],
      ),
    );

    return PartySchema.parse({
      id: party.id,
      universeId,
      size: party.size,
      inviteCode: party.inviteCode,
      members: party.members.map((member) => ({
        userId: member.userId,
        username: member.user.username,
        characterName: byOwner.get(member.userId) ?? null,
        ready: member.ready,
        host: member.isHost,
        mine: member.userId === userId,
      })),
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

/*
  Ce que vaut chaque attribut, et ou il en est de sa montee.

  Calcule ici parce que `modifierOf` et `PROGRESS_STEPS` vivent dans
  `@odyssai/engine`, que le navigateur n'a pas : les recopier la-bas en ferait
  deux verites. `needed` est nul au maximum, ou plus rien n'attend.
*/
function standingOf(
  attributes: Record<Attribute, number>,
  progress: Record<string, unknown>,
): Record<Attribute, AttributeStanding> {
  return Object.fromEntries(
    ATTRIBUTES.map((name) => {
      const score = attributes[name];
      const uses = progress[name];

      return [
        name,
        {
          score,
          modifier: modifierOf(score),
          uses: typeof uses === 'number' && uses > 0 ? uses : 0,
          needed: PROGRESS_STEPS[score] ?? null,
        },
      ];
    }),
  ) as Record<Attribute, AttributeStanding>;
}
