import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Res,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CHARACTER_ATTEMPTS_PER_CALL,
  CHARACTER_TURNS_MAX,
  CharacterMessageRequestSchema,
  type CharacterConversation,
  type CharacterExtractResponse,
  type CharacterStreamEvent,
} from '@odyssai/schemas';
import { isRetryable, type LlmClient } from '@odyssai/llm';
import {
  CHARACTER_EXTRACT_PROMPT_VERSION,
  CHARACTER_OPENING,
  CHARACTER_PROMPT_VERSION,
  converseCharacter,
  extractCharacter,
  type ConversationTurn,
} from '@odyssai/narrator';
import type { User } from '@odyssai/db';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { AlphaOpenGuard } from '../alpha/alpha-open.guard.js';
import { NarratorConfig } from '../config/narrator-config.js';
import {
  CharacterService,
  ConversationOverError,
  TooShortError,
} from './character.service.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { NARRATOR_LLM } from './narrator-llm.provider.js';
import { CreditsService, OutOfCreditsError } from '../credits/credits.service.js';
import { UsageService } from '../usage/usage.service.js';
import { LockedError, WrongStepError } from './onboarding.service.js';

const PING_INTERVAL_MS = 15_000;

// Un tour ouvert : de quoi le relire, et lire son usage une fois le flux clos.
type CharacterTurn = ReturnType<typeof converseCharacter>;

/*
  Etape 3 du parcours : la conversation qui donne sa fiche au personnage.

  Le modele propose, le schema tranche, le joueur corrige. L'extraction ne
  garde donc rien en base : elle rend une proposition, et c'est
  PUT /onboarding qui ecrit ce que le joueur a valide.
*/
@Controller('onboarding/character')
// L'ordre compte : le second relit le joueur que le premier depose.
@UseGuards(SessionGuard, AlphaOpenGuard)
export class CharacterController {
  private readonly logger = new Logger(CharacterController.name);

  constructor(
    private readonly characters: CharacterService,
    private readonly config: NarratorConfig,
    @Inject(NARRATOR_LLM) private readonly llm: LlmClient,
    private readonly moderation: ModerationService,
    private readonly usage: UsageService,
    private readonly credits: CreditsService,
  ) {}

  @Get()
  async conversation(@CurrentUser() user: User): Promise<CharacterConversation> {
    const { universeId, thread } = await this.guard(() => this.characters.open(user));
    const conversation = await this.characters.conversation(universeId, thread);

    // Le premier message n'est pas ecrit en base : tant que le joueur n'a rien
    // dit, il n'y a pas de conversation, et l'enregistrer en creerait une que
    // l'extraction compterait pour rien.
    if (conversation.messages.length > 0) return conversation;

    return {
      ...conversation,
      messages: [
        {
          id: '00000000-0000-7000-8000-000000000000',
          role: 'assistant',
          content: CHARACTER_OPENING[user.locale],
          createdAt: new Date(0).toISOString(),
        },
      ],
    };
  }

  /*
    Repartir de zero sur le personnage seul. Meme garde que la lecture : une
    fois la generation lancee, la conversation est close et le personnage
    tient au monde.
  */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async reset(@CurrentUser() user: User): Promise<void> {
    const { universeId, thread } = await this.guard(() => this.characters.open(user));
    await this.guard(() => this.characters.reset(universeId, thread));
  }

  @Post('messages')
  async message(
    @CurrentUser() user: User,
    @Body() rawBody: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const parsed = CharacterMessageRequestSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException({ code: 'validation_error' });

    // Avant d'ecrire quoi que ce soit : le nom d'un personnage est vu par les
    // autres joueurs le jour ou les univers se croisent.
    const seen = await this.moderation.check(
      parsed.data.content,
      user.locale,
      user.id,
    );
    if (!seen.allow) {
      throw new UnprocessableEntityException({
        code: 'refused',
        reason: seen.reason,
      });
    }

    const { universeId, thread } = await this.guard(() => this.characters.open(user));

    let debit: string | null = null;
    try {
      debit = await this.credits.spend('characterMessage', user.id, universeId);
    } catch (error: unknown) {
      if (error instanceof OutOfCreditsError) {
        throw new HttpException(
          { code: 'out_of_credits', needed: error.needed, balance: error.balance },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      throw error;
    }

    const history = await this.characters.history(universeId, thread);
    await this.guard(() =>
      this.characters.recordUser(universeId, thread, parsed.data.content),
    );

    // A partir d'ici, plus aucune exception ne sort : seulement du SSE.
    this.openStream(res);
    const ping = setInterval(() => res.write(': ping\n\n'), PING_INTERVAL_MS);

    // Sur la reponse et non sur la requete : `req` se ferme des que le corps
    // est entierement lu, donc bien avant le depart du joueur.
    const controller = new AbortController();
    const onClose = () => controller.abort();
    res.on('close', onClose);

    let answer = '';

    try {
      /*
        Le tour rejoue, mais seulement tant que rien n'est parti : une reponse
        rompue apres son premier mot ne se rejoue pas, le joueur l'a deja lue
        et le rejeu recommencerait la phrase sous ses yeux. Avant le premier
        mot, en revanche, il n'a rien vu : un flux qui casse la est une panne
        de transport, et son message est deja en base.
      */
      let turn: CharacterTurn | undefined;
      // Tous les essais, pas seulement le dernier : un rejeu est paye comme le
      // reste, et `record` ecarte de lui-meme celui qui n'a rien rapporte.
      const attempts: CharacterTurn[] = [];

      for (let attempt = 1; attempt <= CHARACTER_ATTEMPTS_PER_CALL; attempt += 1) {
        turn = this.converse({
          user,
          universeId,
          history,
          message: parsed.data.content,
          signal: controller.signal,
          attempt,
        });
        attempts.push(turn);

        try {
          for await (const text of turn.chunks) {
            answer += text;
            this.write(res, { type: 'delta', text });
          }
          break;
        } catch (error: unknown) {
          const last = attempt === CHARACTER_ATTEMPTS_PER_CALL;
          /*
            Le signal en plus de l'erreur : un joueur parti se lit sur lui, et
            c'est la garde qui ne depend pas de la facon dont le fournisseur a
            nomme son abandon.
          */
          const gone = controller.signal.aborted;
          if (answer.length > 0 || last || gone || !isRetryable(error)) throw error;
          this.logger.warn(`tour de personnage rejoue : ${String(error)}`);
        }
      }

      // Ecrite seulement si elle est complete : une reponse coupee en deux
      // reviendrait telle quelle a la reprise, et le modele la relirait.
      if (answer && !controller.signal.aborted) {
        await this.characters.recordAssistant(universeId, thread, answer);
      }

      for (const past of attempts) {
        await this.usage.record({
          kind: 'character',
          provider: this.config.provider,
          userId: user.id,
          universeId,
          usage: past.usage(),
          prices: this.config.prices,
        });
      }

      const turns = await this.characters.turnsUsed(universeId, thread);
      const { canExtract } = await this.characters.conversation(universeId, thread);
      this.write(res, {
        type: 'done',
        turnsLeft: Math.max(0, CHARACTER_TURNS_MAX - turns),
        canExtract,
        // Le marqueur ne vaut demande que si la fiche est extractible : pose
        // trop tot, il ferait appeler une extraction que l'api refuserait.
        sheet: canExtract && (turn?.sheetRequested() ?? false),
      });
    } catch (error: unknown) {
      this.logger.warn(`conversation de personnage en echec : ${String(error)}`);
      if (debit) await this.credits.refund(debit);
      this.write(res, { type: 'error', code: 'upstream_error' });
    } finally {
      clearInterval(ping);
      res.off('close', onClose);
      res.end();
    }
  }

  @Post('extract')
  async extract(@CurrentUser() user: User): Promise<CharacterExtractResponse> {

    const { universeId, thread } = await this.guard(() => this.characters.open(user));
    await this.guard(() => this.characters.assertExtractable(universeId, thread));

    const history = await this.characters.history(universeId, thread);

    const result = await extractCharacter({
      llm: this.llm,
      config: this.config.modelFor('extract'),
      locale: user.locale,
      history,
      trace: {
        name: 'character-extract',
        metadata: {
          universe_id: universeId,
          prompt_version: CHARACTER_EXTRACT_PROMPT_VERSION,
          locale: user.locale,
        },
      },
    });

    // Un essai par ligne : chacun a ete paye, et un rejeu muet ferait mentir
    // le cout d'une fiche.
    for (const usage of result.usages) {
      await this.usage.record({
        kind: 'extract',
        provider: this.config.provider,
        userId: user.id,
        universeId,
        usage,
        prices: this.config.prices,
      });
    }

    /*
      Journalise avant de refuser : sans cette ligne, une extraction qui echoue
      rendait un 503 qu'aucun journal n'expliquait, et il n'y avait plus qu'a
      deviner entre un modele bavard, un JSON coupe par le plafond de sortie et
      un fournisseur en panne. Ni la conversation ni la sortie du modele n'y
      figurent : la raison suffit a savoir ou chercher.
    */
    if (result.kind === 'rejected') {
      const tries = result.attempts > 1 ? `${result.attempts} essais` : 'un essai';
      this.logger.warn(
        `fiche non dressee (${result.reason}) sur ${universeId} en ${tries} : ${result.details}`,
      );
      throw new ServiceUnavailableException({ code: 'upstream_error' });
    }

    return { character: result.character, missing: result.missing };
  }

  /*
    Un appel de conversation. A part pour que le rejeu porte son numero dans la
    trace : deux appels pour un tour se lisent autrement que deux tours.
  */
  private converse(options: {
    user: User;
    universeId: string;
    history: ConversationTurn[];
    message: string;
    signal: AbortSignal;
    attempt: number;
  }): CharacterTurn {
    return converseCharacter({
      llm: this.llm,
      config: this.config.modelFor('character'),
      locale: options.user.locale,
      history: options.history,
      message: options.message,
      signal: options.signal,
      trace: {
        name: 'character',
        metadata: {
          universe_id: options.universeId,
          prompt_version: CHARACTER_PROMPT_VERSION,
          locale: options.user.locale,
          attempt: options.attempt,
        },
      },
    });
  }

  // Traduit les refus du parcours en codes que le front sait lire.
  private async guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error: unknown) {
      if (error instanceof WrongStepError) {
        throw new ConflictException({ code: 'wrong_step' });
      }
      if (error instanceof LockedError) {
        throw new ConflictException({ code: 'locked' });
      }
      if (error instanceof ConversationOverError) {
        throw new ConflictException({ code: 'conversation_over' });
      }
      if (error instanceof TooShortError) {
        throw new UnprocessableEntityException({ code: 'too_short' });
      }
      throw error;
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

  private write(res: Response, event: CharacterStreamEvent): void {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}
