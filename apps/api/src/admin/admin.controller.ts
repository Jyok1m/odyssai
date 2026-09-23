import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@odyssai/db';
import {
  AdjustCreditsRequestSchema,
  CreatePlanRequestSchema,
  UpdateAlphaRequestSchema,
  UpdatePlanRequestSchema,
  type AdminOverview,
  type AdminPlan,
  type AdminUserDetail,
  type AdminMarketingList,
  type AdminUserPage,
  type AlphaStatus,
  type ContactMessage,
  type ContactPage,
  type BugReport,
  type BugReportPage,
} from '@odyssai/schemas';
import type { Response } from 'express';
import { z } from 'zod';
import { AlphaService } from '../alpha/alpha.service.js';
import { ContactService } from '../contact/contact.service.js';
import { BugsService } from '../bugs/bugs.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { BillingService } from '../billing/billing.service.js';
import { AdminGuard } from './admin.guard.js';
import {
  AdminPlansService,
  PlanInUseError,
  PlanNotFoundError,
  PlanProtectedError,
  SlugTakenError,
  StripeUnavailableError,
} from './admin-plans.service.js';
import { AdminService, UserNotFoundError } from './admin.service.js';

/*
  Le tableau de bord d'administration.

  L'ordre des gardes compte : `SessionGuard` depose le joueur sur la requete,
  `AdminGuard` le relit. Inverses, le second ne verrait rien et laisserait
  tout passer. Ils sont poses sur la classe, sans exception : il n'y a ici
  aucune route publique, et il ne doit jamais y en avoir.
*/
@Controller('admin')
@UseGuards(SessionGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly plans: AdminPlansService,
    private readonly billing: BillingService,
    private readonly alpha: AlphaService,
    private readonly contact: ContactService,
    private readonly bugs: BugsService,
  ) {}

  @Get('overview')
  overview(): Promise<AdminOverview> {
    return this.admin.overview();
  }

  @Get('users')
  users(
    @Query('search') search?: string,
    @Query('plan') plan?: string,
    @Query('cursor') cursor?: string,
    @Query('optIn') optIn?: string,
  ): Promise<AdminUserPage> {
    return this.admin.users({ search, plan, cursor, optIn: optIn === 'true' });
  }

  /*
    Les adresses de ceux qui ont consenti.

    Aucun parametre : il n'existe pas de moyen de demander les autres, et
    c'est voulu. Sous /admin, donc derriere les deux gardes.
  */
  @Get('marketing/emails')
  marketingEmails(): Promise<AdminMarketingList> {
    return this.admin.marketingList();
  }

  @Get('users/:id')
  async user(@Param('id') id: string): Promise<AdminUserDetail> {
    return this.guarded(() => this.admin.user(id));
  }

  // Poser une reserve, ou la deplacer. Le grand livre garde la trace et le motif.
  @Post('users/:id/credits')
  async adjustCredits(
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @CurrentUser() by: User,
  ): Promise<AdminUserDetail> {
    const parsed = AdjustCreditsRequestSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException({ code: 'validation_error' });

    return this.guarded(() => this.admin.adjustCredits(id, parsed.data, by));
  }

  /*
    Resilie l'abonnement Stripe d'un joueur, tout de suite.

    Le retour au palier libre n'est pas ecrit ici : il viendra du webhook
    `customer.subscription.deleted`, seule source du droit. L'ecrire des
    maintenant ferait diverger nos lignes de celles de Stripe si l'appel
    echouait a mi-chemin.
  */
  @Delete('users/:id/subscription')
  @HttpCode(204)
  async cancel(@Param('id') id: string): Promise<void> {
    const user = await this.guarded(() => this.admin.user(id));

    if (!user.stripeSubscriptionId) {
      throw new NotFoundException({ code: 'not_found' });
    }

    await this.guarded(() =>
      this.billing.cancelSubscription(user.stripeSubscriptionId!),
    );
  }

  /*
    L'etat de l'alpha. La phase et l'annonce s'ecrivent, les places se lisent :
    un administrateur ne doit pas pouvoir annoncer ce qui n'est plus vrai.
  */
  @Get('alpha')
  alphaStatus(): Promise<AlphaStatus> {
    return this.alpha.status();
  }

  @Patch('alpha')
  updateAlpha(@Body() body: unknown): Promise<AlphaStatus> {
    return this.alpha.update(UpdateAlphaRequestSchema.parse(body));
  }

  /*
    Les messages du formulaire de contact. Ils partent aussi par courriel,
    mais restent lisibles ici : un envoi peut echouer, et une boite peut se
    perdre.
  */
  @Get('contact')
  contactMessages(
    @Query('cursor') cursor?: string,
    @Query('pending') pending?: string,
  ): Promise<ContactPage> {
    return this.contact.list(cursor, pending === 'true');
  }

  @Patch('contact/:id')
  setContactHandled(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ContactMessage> {
    const parsed = z.object({ handled: z.boolean() }).safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: 'invalid_request' });

    return this.contact.setHandled(id, parsed.data.handled);
  }

  // Les bugs signales depuis le jeu, et leur capture, servie a part.
  @Get('bugs')
  bugReports(
    @Query('cursor') cursor?: string,
    @Query('pending') pending?: string,
  ): Promise<BugReportPage> {
    return this.bugs.list(cursor, pending === 'true');
  }

  @Patch('bugs/:id')
  setBugHandled(@Param('id') id: string, @Body() body: unknown): Promise<BugReport> {
    const parsed = z.object({ handled: z.boolean() }).safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: 'invalid_request' });

    return this.bugs.setHandled(id, parsed.data.handled);
  }

  @Get('bugs/:id/screenshot')
  async bugScreenshot(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const image = await this.bugs.screenshot(id);
    res.setHeader('Content-Type', image.type);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(image.data);
  }

  @Get('plans')
  plans_(): Promise<AdminPlan[]> {
    return this.plans.list();
  }

  @Post('plans')
  async createPlan(@Body() rawBody: unknown): Promise<AdminPlan> {
    const parsed = CreatePlanRequestSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException({ code: 'validation_error' });

    return this.guarded(() => this.plans.create(parsed.data));
  }

  @Patch('plans/:id')
  async updatePlan(
    @Param('id') id: string,
    @Body() rawBody: unknown,
  ): Promise<AdminPlan> {
    const parsed = UpdatePlanRequestSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException({ code: 'validation_error' });

    return this.guarded(() => this.plans.update(id, parsed.data));
  }

  @Delete('plans/:id')
  @HttpCode(204)
  async removePlan(@Param('id') id: string): Promise<void> {
    await this.guarded(() => this.plans.remove(id));
  }

  /*
    Traduit les refus metier en reponses HTTP.

    Un seul endroit : la meme erreur remontee par deux routes doit donner le
    meme code, et l'ecran s'appuie dessus pour proposer d'archiver plutot que
    de supprimer.
  */
  private async guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error: unknown) {
      if (error instanceof UserNotFoundError || error instanceof PlanNotFoundError) {
        throw new NotFoundException({ code: 'not_found' });
      }
      if (error instanceof SlugTakenError) {
        throw new ConflictException({ code: 'slug_taken' });
      }
      if (error instanceof PlanInUseError) {
        throw new ConflictException({
          code: 'plan_in_use',
          message: `${error.subscribers}`,
        });
      }
      if (error instanceof PlanProtectedError) {
        throw new ConflictException({ code: 'plan_protected' });
      }
      if (error instanceof StripeUnavailableError) {
        throw new ServiceUnavailableException({ code: 'stripe_error' });
      }
      throw error;
    }
  }
}
