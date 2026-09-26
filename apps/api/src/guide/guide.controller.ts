import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import {
  GuideAskRequestSchema,
  GuidePassRequestSchema,
  UiLocale,
  type GuideAnswerSource,
  type GuideStreamEvent,
  type GuideSuggestionsResponse,
} from '@odyssai/schemas';
import type { LlmClient } from '@odyssai/llm';
import {
  GUIDE_CORPUS_VERSION,
  GUIDE_DEGRADED_REPLY,
  GUIDE_OFF_TOPIC_REPLY,
  GUIDE_PROMPT_VERSION,
  buildGuideMessages,
  guide,
  questionHash,
  type GuideUsage,
} from '@odyssai/narrator';
import { AppConfig } from '../config/app-config.js';
import { GuideConfig } from '../config/guide-config.js';
import type { GuideSource } from '@odyssai/db';
import { GuideBudgetService } from './guide-budget.service.js';
import { GuideFaqService } from './guide-faq.service.js';
import { GuideJournalService } from './guide-journal.service.js';
import { GuideLimitsService } from './guide-limits.service.js';
import { GuidePassService } from './guide-pass.service.js';
import { GuidePricingService } from './guide-pricing.service.js';
import { GUIDE_LLM } from './guide-llm.provider.js';

const PING_INTERVAL_MS = 15_000;
const SUGGESTIONS_MAX = 6;
const BUSY_RETRY_SECONDS = 5;

@Controller('guide')
export class GuideController {
  private readonly logger = new Logger(GuideController.name);

  constructor(
    private readonly config: AppConfig,
    private readonly guideConfig: GuideConfig,
    private readonly faq: GuideFaqService,
    private readonly limits: GuideLimitsService,
    private readonly budget: GuideBudgetService,
    private readonly passes: GuidePassService,
    private readonly journal: GuideJournalService,
    private readonly pricing: GuidePricingService,
    @Inject(GUIDE_LLM) private readonly llm: LlmClient,
  ) {}

  // Ni pass ni appel au modele : ce chemin ne coute rien.
  @Get('suggestions')
  suggestions(
    @Query('locale') rawLocale: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): GuideSuggestionsResponse {
    const locale = UiLocale.catch('fr').parse(rawLocale);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return { suggestions: this.faq.suggestions(locale).slice(0, SUGGESTIONS_MAX) };
  }

  @Post('pass')
  @HttpCode(HttpStatus.NO_CONTENT)
  async pass(
    @Body() rawBody: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const parsed = GuidePassRequestSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException({ code: 'validation_error' });

    const hashedIp = this.limits.key(req.ip ?? '');
    const verdict = await this.limits.consumePass(hashedIp);
    if (!verdict.allowed) {
      res.setHeader('Retry-After', String(verdict.retryAfterSeconds ?? 60));
      throw new HttpException(
        { code: 'rate_limited', retryAfterSeconds: verdict.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const ok = await this.passes.verifyTurnstile(parsed.data.turnstileToken, req.ip);
    if (!ok) throw new ForbiddenException({ code: 'pass_required' });

    const id = await this.passes.issue();
    res.cookie(this.config.cookies.guidePass, id, {
      ...this.cookieOptions(),
      maxAge: this.guideConfig.pass.ttlSeconds * 1000,
    });
  }

  @Post('ask')
  async ask(
    @Body() rawBody: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // 1. L'identifiant sert au journal et aux metadonnees de trace.
    const questionId = uuidv7();

    // 2. Validation.
    const parsed = GuideAskRequestSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException({ code: 'validation_error' });
    const { question, locale } = parsed.data;
    const normalizedHash = questionHash(locale, question);

    const base = {
      id: questionId,
      locale,
      question,
      normalizedHash,
      promptVersion: GUIDE_PROMPT_VERSION,
      corpusVersion: GUIDE_CORPUS_VERSION,
    };

    // 3. Guide coupe.
    if (!this.guideConfig.enabled) {
      this.openStream(res);
      this.writeFixed(res, 'degraded', GUIDE_DEGRADED_REPLY[locale]);
      await this.journal.record({ ...base, source: 'degraded' });
      return;
    }

    // 4. FAQ validee : aucun pass, aucune limite, aucune trace, aucun cout.
    const entry = this.faq.find(locale, question);
    if (entry) {
      this.openStream(res);
      this.writeFixed(res, 'faq', entry.answer);
      await this.journal.record({ ...base, source: 'faq', faqEntryId: entry.id });
      return;
    }

    // 5. Pass.
    const passId = this.readCookie(req, this.config.cookies.guidePass);
    if (!passId) throw new ForbiddenException({ code: 'pass_required' });

    const hashedIp = this.limits.key(req.ip ?? '');

    // 6. Limites par IP.
    const verdict = await this.limits.consume(hashedIp);
    if (!verdict.allowed) {
      res.setHeader('Retry-After', String(verdict.retryAfterSeconds ?? 60));
      throw new HttpException(
        { code: 'rate_limited', retryAfterSeconds: verdict.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 7. Creneau de concurrence.
    const slot = await this.limits.acquireSlot(questionId);
    if (!slot) {
      res.setHeader('Retry-After', String(BUSY_RETRY_SECONDS));
      throw new HttpException(
        { code: 'busy', retryAfterSeconds: BUSY_RETRY_SECONDS },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 8. Budget, estime sur le prompt complet.
    // Les tarifs en font partie : les compter apres coup sous-estimerait la
    // reservation, et c'est le budget qui garde la depense.
    const live = await this.pricing.block(locale);
    const promptChars = buildGuideMessages({ question, locale, live }).reduce(
      (total, message) => total + message.content.length,
      0,
    );
    const granted = await this.budget.reserve(
      questionId,
      this.budget.estimate(promptChars),
    );
    if (!granted) {
      await this.limits.releaseSlot(questionId);
      this.openStream(res);
      this.writeFixed(res, 'degraded', GUIDE_DEGRADED_REPLY[locale]);
      await this.journal.record({ ...base, source: 'degraded' });
      return;
    }

    // 9. Le pass n'est decremente qu'une fois tout le reste accorde.
    const left = await this.passes.consume(passId);
    if (left === null) {
      await this.limits.releaseSlot(questionId);
      await this.budget.settle(questionId, undefined);
      throw new ForbiddenException({ code: 'pass_required' });
    }

    // 10. A partir d'ici, plus aucune exception ne sort : seulement du SSE.
    this.openStream(res);
    const ping = setInterval(() => res.write(': ping\n\n'), PING_INTERVAL_MS);

    // 11. Le depart du visiteur coupe la generation amont.
    // Sur la reponse et non sur la requete : `req` se ferme des que le corps
    // est entierement lu, donc bien avant le depart du visiteur.
    const controller = new AbortController();
    const onClose = () => controller.abort();
    res.on('close', onClose);

    let usage: GuideUsage | undefined;
    let source: GuideSource = 'llm';
    let answer = '';

    try {
      // 12. Aucune donnee d'adresse dans les metadonnees, meme hachee.
      const result = await guide({
        llm: this.llm,
        config: this.guideConfig.model,
        input: { question, locale, live },
        signal: controller.signal,
        trace: {
          name: 'guide',
          metadata: {
            guide_question_id: questionId,
            prompt_version: GUIDE_PROMPT_VERSION,
            corpus_version: GUIDE_CORPUS_VERSION,
            locale,
            provider: this.guideConfig.provider,
          },
        },
      });

      if (result.kind === 'off_topic') {
        source = 'off_topic';
        usage = result.usage;
        this.write(res, { type: 'meta', source: 'off_topic' });
        this.write(res, { type: 'delta', text: GUIDE_OFF_TOPIC_REPLY[locale] });
        this.write(res, { type: 'done' });
      } else {
        this.write(res, { type: 'meta', source: 'llm' });
        for await (const text of result.chunks) {
          answer += text;
          this.write(res, { type: 'delta', text });
        }
        usage = result.usage();
        this.write(res, { type: 'done' });
      }
    } catch (error: unknown) {
      source = 'error';
      this.logger.warn(`guide en echec : ${String(error)}`);
      this.write(res, { type: 'error', code: 'upstream_error' });
    } finally {
      // 13. Regler, liberer, journaliser, terminer. Dans cet ordre.
      clearInterval(ping);
      res.off('close', onClose);

      // Un Redis tombe ne doit ni masquer l'issue ni laisser le flux ouvert.
      await this.budget.settle(questionId, usage).catch((error: unknown) => {
        this.logger.warn(`budget non regle : ${String(error)}`);
      });
      await this.limits.releaseSlot(questionId).catch((error: unknown) => {
        this.logger.warn(`creneau non rendu : ${String(error)}`);
      });

      await this.journal.record({
        ...base,
        source,
        provider: this.guideConfig.provider,
        model: usage?.model ?? this.guideConfig.model.model,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        reasoningTokens: usage?.reasoningTokens,
        costUsd: this.budget.realCost(usage),
        // Seules les reponses generees sont conservees, jamais les textes fixes.
        answer: source === 'llm' && answer ? answer : undefined,
      });

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

  private write(res: Response, event: GuideStreamEvent): void {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  // Reponse fixe : meta, un seul delta, done, puis fin.
  private writeFixed(
    res: Response,
    source: GuideAnswerSource,
    text: string,
  ): void {
    this.write(res, { type: 'meta', source });
    this.write(res, { type: 'delta', text });
    this.write(res, { type: 'done' });
    res.end();
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.cookies.secure,
      sameSite: 'lax',
      path: '/',
    };
  }

  private readCookie(req: Request, name: string): string | undefined {
    const jar = req.cookies as Record<string, unknown> | undefined;
    const value = jar?.[name];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}

/*
  UUID v7 : horodatage sur 48 bits puis de l'aleatoire, donc ordonne dans le
  temps comme les identifiants de `users`. Node ne sait generer que des v4.
*/
export function uuidv7(): string {
  const bytes = randomBytes(16);
  const ms = Date.now();

  bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ms / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ms / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
