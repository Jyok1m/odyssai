import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { TUNING, conditionOf, hpMaxOf, isClean, type Progress } from '@odyssai/engine';
import type { LlmClient } from '@odyssai/llm';
import {
  AttributesSchema,
  CanonFactSchema,
  CharacterSheetSchema,
  MarksSchema,
  PersonalitySchema,
  WorldBibleSchema,
  WorldCharterSchema,
  type CanonFact,
  type CharacterSheet,
  type Entity,
  type Mark,
  type WorldBible,
  type WorldCharter,
} from '@odyssai/schemas';
import type { PartyActor } from '@odyssai/narrator';
import { PrismaClient, type User } from '@odyssai/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { NarratorConfig } from '../config/narrator-config.js';
import { NARRATOR_LLM } from '../onboarding/narrator-llm.provider.js';
import { UsageService } from '../usage/usage.service.js';
import { openStoryWhere } from '../stories/stories.service.js';

// Les deux bornes viennent de l'index de reglages : c'est `recentTurns` qui
// decide de ce que coute un tour, et le curseur doit se voir avec les autres.
const { recentTurns: RECENT_TURNS, recalledMax: RECALLED_MAX } = TUNING.turn;

const CHANNEL = 'game_turn' as const;

export interface TurnWorld {
  /*
    Ou ce tour s'ecrit : ses messages, ses tours, ses entites, son canon.
    C'est toujours une histoire du joueur, meme en visite.
  */
  universeId: string;
  /*
    Le monde qu'il lit. Le meme, sauf en visite : une histoire qui en visite
    une autre emprunte sa charte, sa bible et ses habitants, et n'ecrit
    jamais chez elle. C'est ce qui tient la regle « un univers n'ecrit jamais
    dans l'etat d'un autre » sans demander une seconde boucle de tour.
  */
  sourceId: string;
  charter: WorldCharter;
  bible: WorldBible;
  character: CharacterSheet;
  /*
    La ligne de la fiche, pour ecrire dessus : une fiche par joueur et par
    univers, l'unicite n'est plus sur l'univers seul.
  */
  characterId: string | null;
  /*
    Les oeuvres citees a l'inspiration, pour la garde sur les emprunts.

    Elles ne partent jamais dans un prompt : c'est `findBorrowedNames` qui les
    lit, pour relire ce que le meneur vient d'ecrire. Le canon grandit a chaque
    tour, et un nom refuse a la generation ne doit pas rentrer par la.

    Dans une table, l'union des sieges : un nom emprunte peut venir de
    l'inspiration de n'importe lequel.
  */
  works: string[];
  /*
    Les compteurs de progression, a cote de la fiche et non dedans : la fiche
    dit ce que le personnage est, ceux-ci disent ce qu'il a pratique depuis sa
    derniere montee. Le meneur n'en voit rien.
  */
  progress: Progress;
  /*
    Dans quel etat il se tient, a cote de la fiche pour la meme raison : la
    fiche dit ce qu'il est, celle-ci ce qu'il a pris. `hp` nul en base vaut la
    reserve pleine, le maximum derivant de `corps`.
  */
  health: { hp: number; hpMax: number; rest: number };
  // Ce que le personnage porte, des noms et rien d'autre.
  inventory: string[];
  /*
    L'essence dont ce personnage est une incarnation, et ce qu'elle a deja
    rapporte. Nulle pour une fiche d'avant les essences : le tour se joue, il
    ne laisse simplement pas de marque.
  */
  essence: { id: string; marks: Mark[] } | null;
  /*
    Ou en est l'histoire. Absent pour un monde genere avant l'arc : le meneur
    joue alors comme il jouait, sans but a atteindre.
  */
  act: number | null;
  // Ce que le monde sait, cache compris : le meneur connait les secrets.
  entities: Entity[];
  /*
    Les personnages joues, un par siege. Nul dans une histoire solo : le
    prompt du tour seul n'en a pas besoin, celui de la table le demande.

    `authors` donne, par membre, le nom crible qui signe ses messages.
    `others` porte les noms bruts des personnages des autres membres : il
    ne sert qu'a `arbitrateCanon` et n'entre dans aucun prompt.
  */
  party: {
    actors: PartyActor[];
    members: string[];
    authors: Map<string, string | null>;
    others: string[];
  } | null;
}

export interface TurnMemory {
  canon: CanonFact[];
  recent: {
    role: 'user' | 'assistant';
    content: string;
    memberId: string | null;
    // Dans une table, le nom qui signe un message de joueur, nul s'il ne se lit plus.
    author?: string | null;
  }[];
  recalled: string[];
  nextSeq: number;
}

/*
  Un personnage d'une table tel que le meneur le voit, relu a chaque tour.

  La fiche est ecrite par un autre joueur : elle repasse par ses bornes et
  par le crible lexical avant d'entrer dans le prompt d'un autre. Un nom
  illisible ou refuse emporte le resume avec lui, le meneur ne voit alors
  qu'un voyageur sans nom.
*/
export function partyActor(
  row: { name: string | null; personality: unknown; attributes: unknown; hp: number | null },
  active: boolean,
): PartyActor {
  const name = CharacterSheetSchema.shape.name.safeParse(row.name);
  const personality = PersonalitySchema.safeParse(row.personality);
  const summary = personality.success
    ? personality.data.summary || personality.data.traits.join(', ')
    : '';

  const attributes = AttributesSchema.safeParse(row.attributes);
  const hpMax = attributes.success ? hpMaxOf(attributes.data.corps) : 1;
  const condition = conditionOf(row.hp ?? hpMax, hpMax);

  if (!name.success || !isClean(name.data)) {
    return { name: null, summary: '', condition, active };
  }

  return {
    name: name.data,
    summary: isClean(summary) ? summary : '',
    condition,
    active,
  };
}

/*
  Ce que le meneur a en tete au moment de jouer.

  Tout est en base, rien ne se perd. Ce qui entre dans un tour, en revanche,
  est choisi : la charte et le canon toujours, les derniers tours mot pour mot,
  et des tours anciens seulement s'ils ressemblent a ce que le joueur vient
  de dire.
*/
@Injectable()
export class TurnMemoryService implements OnModuleInit {
  private readonly logger = new Logger(TurnMemoryService.name);

  /*
    L'extension n'est pas toujours la. L'image Postgres officielle ne l'embarque
    pas, et le rappel long ne doit pas empecher de jouer : sans elle on se
    contente des derniers tours, et la memoire longue s'allume le jour ou
    l'image change, sans rien toucher au code.
  */
  private vectors = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(NARRATOR_LLM) private readonly llm: LlmClient,
    private readonly config: NarratorConfig,
    private readonly usage: UsageService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Dans un try, et non un `.catch` : une base qui ne repond pas rejette,
    // mais un client reduit jette avant meme d'avoir une promesse a rejeter.
    // Une sonde de capacite ne doit jamais pouvoir faire tomber le demarrage.
    try {
      const rows = await this.prisma.$queryRawUnsafe<{ ok: boolean }[]>(
        "select exists(select 1 from pg_extension where extname = 'vector') as ok",
      );
      this.vectors = rows[0]?.ok === true;
    } catch {
      this.vectors = false;
    }
    this.logger.log(
      this.vectors
        ? 'memoire longue active, rappel par similarite'
        : "extension vector absente : le meneur ne se souvient que des derniers tours",
    );
  }

  get hasLongMemory(): boolean {
    return this.vectors;
  }

  // Le monde de l'histoire ouverte, ou `null` si la partie n'est pas jouable.
  async world(user: Pick<User, 'id' | 'currentUniverseId'>): Promise<TurnWorld | null> {
    const where = openStoryWhere(user);
    const universe = where
      ? await this.prisma.universe.findFirst({
          where,
          include: {
            /*
              Sa fiche, et lui seul : une histoire solo en porte une, une
              table une par membre, et le filtre sur le proprietaire rend
              toujours la sienne.
            */
            characters: {
              where: { ownerId: user.id },
              include: { essence: { select: { id: true, marks: true } } },
            },
            entities: { orderBy: { createdAt: 'asc' } },
            /*
              Le monde visite, quand il y en a un : c'est lui qu'on lit. Ses
              entites viennent avec, cachees comprises : le meneur joue ce
              monde-la, il en connait les secrets.
            */
            visiting: {
              include: { entities: { orderBy: { createdAt: 'asc' } } },
            },
            party: {
              include: {
                members: {
                  orderBy: { joinedAt: 'asc' },
                  select: { userId: true, works: true },
                },
              },
            },
          },
        })
      : null;

    if (!universe || universe.step !== 'ready') return null;

    // La source : le monde visite s'il y en a un, le sien sinon.
    const source = universe.visiting ?? universe;

    const charter = WorldCharterSchema.safeParse(source.charter);
    const bible = WorldBibleSchema.safeParse(source.bible);
    const row = universe.characters[0] ?? null;
    const character = CharacterSheetSchema.safeParse({
      name: row?.name ?? undefined,
      gender: row?.gender ?? undefined,
      age: row?.age ?? undefined,
      personality: row?.personality ?? undefined,
      attributes: row?.attributes ?? undefined,
      talents: row?.talents ?? [],
    });

    if (!charter.success || !bible.success || !character.success || !row) {
      this.logger.error(
        `monde ${source.id} illisible malgre l'etape ready` +
          ` (chartre ${charter.success}, bible ${bible.success}, fiche ${character.success}, ligne ${row !== null})`,
      );
      return null;
    }

    const hpMax = hpMaxOf(character.data.attributes.corps);

    /*
      Des marques illisibles valent une liste vide : on n'en ecrase aucune,
      la borne s'applique quand meme, et le tour ne tombe pas pour autant.
    */
    const marks = MarksSchema.safeParse(row.essence?.marks);

    return {
      universeId: universe.id,
      sourceId: source.id,
      charter: charter.data,
      bible: bible.data,
      character: character.data,
      characterId: row.id,
      /*
        Les oeuvres citees : celles du monde qu'on lit en solo, l'union des
        sieges dans une table. C'est contre elles que la garde relit ce que
        le meneur ecrit, et c'est ce monde-la qu'il ecrit.
      */
      works: universe.party
        ? universe.party.members.flatMap((member) => member.works)
        : source.works,
      progress: (row.progress ?? {}) as Progress,
      essence: row.essence
        ? {
            id: row.essence.id,
            marks: marks.success ? marks.data : [],
          }
        : null,
      health: {
        hp: row.hp ?? hpMax,
        hpMax,
        rest: row.rest ?? 0,
      },
      inventory: row.inventory ?? [],
      /*
        L'arc appartient a l'histoire qu'on joue, pas au monde qu'on lit : un
        visiteur n'herite pas de celle de son hote, il vient y vivre la
        sienne. Le meneur joue alors sans but a atteindre, comme dans un monde
        genere avant les arcs.
      */
      act: universe.visiting
        ? null
        : universe.bible && bible.data.arc
          ? (universe.arcAct ?? 1)
          : null,
      /*
        Les habitants du monde lu d'abord, ce que cette histoire y a decouvert
        ensuite. Le meneur les connait tous, caches compris ; ce qu'il posera
        de neuf s'ecrira du cote de l'histoire, jamais chez l'hote.
      */
      entities: [...(universe.visiting?.entities ?? []), ...universe.entities].map(
        (entity) => ({
          name: entity.name,
          kind: entity.kind as Entity['kind'],
          known: entity.known,
          hidden: entity.hidden,
        }),
      ),
      party: universe.party
        ? await this.party(universe.id, universe.party.members, user.id)
        : null,
    };
  }

  /*
    Les personnages joues de la table, pour le prompt de partie : chacun avec
    son nom, une ligne de lui, et son etat en un mot. Le personnage du joueur
    qui lit est marque actif : c'est lui dont c'est le tour.

    La fiche du joueur actif part entiere dans le prompt, les autres en une
    ligne : le meneur doit savoir qui est la, pas recalculer leurs jets.
  */
  private async party(
    universeId: string,
    members: { userId: string }[],
    activeId: string,
  ): Promise<NonNullable<TurnWorld['party']>> {
    const rows = await this.prisma.character.findMany({
      where: { universeId, ownerId: { in: members.map((member) => member.userId) } },
      select: {
        ownerId: true,
        name: true,
        personality: true,
        attributes: true,
        hp: true,
      },
    });

    const byOwner = new Map(rows.flatMap((row) => (row.ownerId ? [[row.ownerId, row] as const] : [])));

    const seated = members.flatMap((member) => {
      const row = byOwner.get(member.userId);
      if (!row || !row.name) return [];
      return [
        { userId: member.userId, raw: row.name, actor: partyActor(row, member.userId === activeId) },
      ];
    });

    return {
      actors: seated.map((seat) => seat.actor),
      members: members.map((member) => member.userId),
      authors: new Map(seated.map((seat) => [seat.userId, seat.actor.name])),
      others: seated.filter((seat) => seat.userId !== activeId).map((seat) => seat.raw),
    };
  }

  /*
    Ce que le meneur se rappelle.

    Le canon vient des deux cotes : ce qui est vrai dans le monde qu'on lit, et
    ce que cette histoire y a ajoute. Les tours, eux, sont ceux de l'histoire
    seule : ceux de l'hote sont sa partie a lui, et un visiteur n'y etait pas.
  */
  async recall(
    where: Pick<TurnWorld, 'universeId' | 'sourceId'> & Partial<Pick<TurnWorld, 'party'>>,
    message: string,
  ): Promise<TurnMemory> {
    const { universeId, sourceId, party } = where;

    const [canonRows, recentRows, last] = await Promise.all([
      this.prisma.canonFact.findMany({
        where: { universeId: { in: [...new Set([universeId, sourceId])] } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.conversationMessage.findMany({
        where: { universeId, channel: CHANNEL },
        orderBy: { seq: 'desc' },
        take: RECENT_TURNS,
      }),
      this.prisma.conversationMessage.findFirst({
        where: { universeId, channel: CHANNEL },
        orderBy: { seq: 'desc' },
        select: { seq: true },
      }),
    ]);

    /*
      Dans une table, chaque message de joueur garde son auteur : un membre
      parti, ou dont la fiche ne se lit plus, signe d'un nom neutre.
    */
    const recent = recentRows.reverse().map((row) => ({
      role: row.role,
      content: row.content,
      memberId: row.memberId ?? null,
      ...(party && row.role === 'user'
        ? { author: row.memberId ? (party.authors.get(row.memberId) ?? null) : null }
        : {}),
    }));

    const canon = canonRows.flatMap((row) => {
      const parsed = CanonFactSchema.safeParse({
        subject: row.subject,
        statement: row.statement,
      });
      return parsed.success ? [parsed.data] : [];
    });

    return {
      canon,
      recent,
      recalled: await this.recalled(universeId, message, recentRows.length),
      nextSeq: last ? last.seq + 1 : 0,
    };
  }

  /*
    Les tours anciens qui ressemblent a la demande. Ceux deja rendus mot pour
    mot sont exclus : les repeter couterait des tokens sans rien apprendre.
  */
  private async recalled(
    universeId: string,
    message: string,
    recentCount: number,
  ): Promise<string[]> {
    if (!this.vectors || !message.trim() || recentCount < RECENT_TURNS) return [];

    try {
      const embedded = await this.llm.embed({
        model: this.config.embed.model,
        inputs: [message],
      });
      const vectors = embedded.vectors;

      await this.usage.record({
        kind: 'embedding',
        provider: this.config.provider,
        universeId,
        // Un embedding n'a pas de sortie : seule l'entree est facturee.
        usage: {
          model: embedded.model,
          inputTokens: embedded.inputTokens,
          outputTokens: 0,
        },
      });

      const literal = `[${vectors[0]!.join(',')}]`;

      const rows = await this.prisma.$queryRawUnsafe<{ content: string }[]>(
        `select content
           from conversation_messages
          where universe_id = $1::uuid
            and channel = 'game_turn'
            and embedding is not null
            and seq < (
              select coalesce(max(seq), 0) - $2
                from conversation_messages
               where universe_id = $1::uuid and channel = 'game_turn'
            )
          order by embedding <=> $3::vector
          limit $4`,
        universeId,
        RECENT_TURNS,
        literal,
        RECALLED_MAX,
      );

      return rows.map((row) => row.content);
    } catch (error: unknown) {
      // Un rappel rate n'est pas un tour rate : le meneur joue avec ce qu'il a.
      this.logger.warn(`rappel par similarite indisponible : ${String(error)}`);
      return [];
    }
  }
}
