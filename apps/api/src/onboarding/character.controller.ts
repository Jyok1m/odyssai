import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
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
  CHARACTER_TURNS_MAX,
  CharacterMessageRequestSchema,
  type CharacterConversation,
  type CharacterExtractResponse,
  type CharacterStreamEvent,
} from '@odyssai/schemas';
import type { LlmClient } from '@odyssai/llm';
import {
  CHARACTER_EXTRACT_PROMPT_VERSION,
  CHARACTER_OPENING,
  CHARACTER_PROMPT_VERSION,
  converseCharacter,
  extractCharacter,
} from '@odyssai/narrator';
import type { User } from '@odyssai/db';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { NarratorConfig } from '../config/narrator-config.js';
import {
  CharacterService,
  ConversationOverError,
  TooShortError,
} from './character.service.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { NARRATOR_LLM } from './narrator-llm.provider.js';
import { LockedError, WrongStepError } from './onboarding.service.js';

const PING_INTERVAL_MS = 15_000;

/**
 * Etape 3 du parcours : la conversation qui donne sa fiche au personnage.
 *
 * Le modele propose, le schema tranche, le joueur corrige. L'extraction ne
 * garde donc rien en base : elle rend une proposition, et c'est
 * PUT /onboarding qui ecrit ce que le joueur a valide.
 */
@Controller('onboarding/character')
@UseGuards(SessionGuard)
export class CharacterController {
  private readonly logger = new Logger(CharacterController.name);

  constructor(
    private readonly characters: CharacterService,
    private readonly config: NarratorConfig,
    @Inject(NARRATOR_LLM) private readonly llm: LlmClient,
    private readonly moderation: ModerationService,
  ) {}

  @Get()
  async conversation(@CurrentUser() user: User): Promise<CharacterConversation> {
    const universeId = await this.guard(() => this.characters.open(user));
    const conversation = await this.characters.conversation(universeId);

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

  @Post('messages')
  async message(
    @CurrentUser() user: User,
    @Body() rawBody: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const parsed = CharacterMessageRequestSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException({ code: 'validation_error' });

    this.assertConfigured();

    // Avant d'ecrire quoi que ce soit : le nom d'un personnage est vu par les
    // autres joueurs le jour ou les univers se croisent.
    const seen = await this.moderation.check(parsed.data.content, user.locale);
    if (!seen.allow) {
      throw new UnprocessableEntityException({
        code: 'refused',
        reason: seen.reason,
      });
    }

    const universeId = await this.guard(() => this.characters.open(user));

    const history = await this.characters.history(universeId);
    await this.guard(() =>
      this.characters.recordUser(universeId, parsed.data.content),
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
      const turn = converseCharacter({
        llm: this.llm,
        config: this.config.model,
        locale: user.locale,
        history,
        message: parsed.data.content,
        signal: controller.signal,
        trace: {
          name: 'character',
          metadata: {
            universe_id: universeId,
            prompt_version: CHARACTER_PROMPT_VERSION,
            locale: user.locale,
          },
        },
      });

      for await (const text of turn.chunks) {
        answer += text;
        this.write(res, { type: 'delta', text });
      }

      // Ecrite seulement si elle est complete : une reponse coupee en deux
      // reviendrait telle quelle a la reprise, et le modele la relirait.
      if (answer && !controller.signal.aborted) {
        await this.characters.recordAssistant(universeId, answer);
      }

      const turns = await this.characters.turnsUsed(universeId);
      this.write(res, {
        type: 'done',
        turnsLeft: Math.max(0, CHARACTER_TURNS_MAX - turns),
        canExtract: (await this.characters.conversation(universeId)).canExtract,
      });
    } catch (error: unknown) {
      this.logger.warn(`conversation de personnage en echec : ${String(error)}`);
      this.write(res, { type: 'error', code: 'upstream_error' });
    } finally {
      clearInterval(ping);
      res.off('close', onClose);
      res.end();
    }
  }

  @Post('extract')
  async extract(@CurrentUser() user: User): Promise<CharacterExtractResponse> {
    this.assertConfigured();

    const universeId = await this.guard(() => this.characters.open(user));
    await this.guard(() => this.characters.assertExtractable(universeId));

    const history = await this.characters.history(universeId);

    const result = await extractCharacter({
      llm: this.llm,
      config: this.config.model,
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

    if (result.kind === 'invalid_json') {
      throw new ServiceUnavailableException({ code: 'upstream_error' });
    }

    return { character: result.character, missing: result.missing };
  }

  private assertConfigured(): void {
    // Le modele se choisit par evaluation : tant qu'aucun n'a gagne, dire
    // indisponible vaut mieux qu'appeler un modele vide.
    if (!this.config.configured) {
      throw new ServiceUnavailableException({ code: 'upstream_error' });
    }
  }

  /** Traduit les refus du parcours en codes que le front sait lire. */
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
