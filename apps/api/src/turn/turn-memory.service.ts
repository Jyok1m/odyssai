import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { TUNING, type Progress } from '@odyssai/engine';
import type { LlmClient } from '@odyssai/llm';
import {
  CanonFactSchema,
  CharacterSheetSchema,
  WorldBibleSchema,
  WorldCharterSchema,
  type CanonFact,
  type CharacterSheet,
  type Entity,
  type WorldBible,
  type WorldCharter,
} from '@odyssai/schemas';
import { PrismaClient } from '@odyssai/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { NarratorConfig } from '../config/narrator-config.js';
import { NARRATOR_LLM } from '../onboarding/narrator-llm.provider.js';
import { UsageService } from '../usage/usage.service.js';

// Les deux bornes viennent de l'index de reglages : c'est `recentTurns` qui
// decide de ce que coute un tour, et le curseur doit se voir avec les autres.
const { recentTurns: RECENT_TURNS, recalledMax: RECALLED_MAX } = TUNING.turn;

const CHANNEL = 'game_turn' as const;

export interface TurnWorld {
  universeId: string;
  charter: WorldCharter;
  bible: WorldBible;
  character: CharacterSheet;
  /*
    Les oeuvres citees a l'inspiration, pour la garde sur les emprunts.

    Elles ne partent jamais dans un prompt : c'est `findBorrowedNames` qui les
    lit, pour relire ce que le meneur vient d'ecrire. Le canon grandit a chaque
    tour, et un nom refuse a la generation ne doit pas rentrer par la.
  */
  works: string[];
  /*
    Les compteurs de progression, a cote de la fiche et non dedans : la fiche
    dit ce que le personnage est, ceux-ci disent ce qu'il a pratique depuis sa
    derniere montee. Le meneur n'en voit rien.
  */
  progress: Progress;
  // Ce que le personnage porte, des noms et rien d'autre.
  inventory: string[];
  /*
    Ou en est l'histoire. Absent pour un monde genere avant l'arc : le meneur
    joue alors comme il jouait, sans but a atteindre.
  */
  act: number | null;
  // Ce que le monde sait, cache compris : le meneur connait les secrets.
  entities: Entity[];
}

export interface TurnMemory {
  canon: CanonFact[];
  recent: { role: 'user' | 'assistant'; content: string }[];
  recalled: string[];
  nextSeq: number;
}

/*
  Ce que le meneur a en tete au moment de jouer.

  Tout est en base, rien ne se perd. Ce qui entre dans un tour, en revanche,
  est choisi : la charte et le canon toujours, les derniers tours mot pour mot,
  et des tours anciens seulement s'ils ressemblent a ce que le joueur vient de
  dire.
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

  // Le monde, ou `null` si la partie n'est pas jouable.
  async world(userId: string): Promise<TurnWorld | null> {
    const universe = await this.prisma.universe.findUnique({
      where: { ownerId: userId },
      include: { character: true, entities: { orderBy: { createdAt: 'asc' } } },
    });

    if (!universe || universe.step !== 'ready') return null;

    const charter = WorldCharterSchema.safeParse(universe.charter);
    const bible = WorldBibleSchema.safeParse(universe.bible);
    const character = CharacterSheetSchema.safeParse({
      name: universe.character?.name ?? undefined,
      gender: universe.character?.gender ?? undefined,
      age: universe.character?.age ?? undefined,
      personality: universe.character?.personality ?? undefined,
      attributes: universe.character?.attributes ?? undefined,
      talents: universe.character?.talents ?? [],
    });

    if (!charter.success || !bible.success || !character.success) {
      this.logger.error(`monde ${universe.id} illisible malgre l'etape ready`);
      return null;
    }

    return {
      universeId: universe.id,
      charter: charter.data,
      bible: bible.data,
      character: character.data,
      works: universe.works,
      progress: (universe.character?.progress ?? {}) as Progress,
      inventory: universe.character?.inventory ?? [],
      act: universe.bible && bible.data.arc ? (universe.arcAct ?? 1) : null,
      entities: universe.entities.map((row) => ({
        name: row.name,
        kind: row.kind as Entity['kind'],
        known: row.known,
        hidden: row.hidden,
      })),
    };
  }

  async recall(universeId: string, message: string): Promise<TurnMemory> {
    const [canonRows, recentRows, last] = await Promise.all([
      this.prisma.canonFact.findMany({
        where: { universeId },
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

    const recent = recentRows
      .reverse()
      .map((row) => ({ role: row.role, content: row.content }));

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
