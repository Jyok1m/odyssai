import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '@odyssai/db';
import {
  CheckoutRequestSchema,
  type BillingRedirect,
  type BillingCatalog,
  type BillingSummary,
} from '@odyssai/schemas';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { BillingDisabledError, BillingService } from './billing.service.js';

/*
  Abonnements et reserve de credits.

  Le garde est pose methode par methode, et non sur la classe : le webhook
  n'est pas appele par un navigateur et n'a pas de session.
*/
@Controller('billing')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(private readonly billing: BillingService) {}

  @Get()
  @UseGuards(SessionGuard)
  summary(@CurrentUser() user: User): Promise<BillingSummary> {
    return this.billing.summary(user);
  }

  /*
    Sans garde : le bareme n'a rien de personnel, et la page de tarifs doit
    pouvoir s'afficher avant de s'inscrire.
  */
  @Get('catalog')
  catalog(): Promise<BillingCatalog> {
    return this.billing.catalog();
  }

  @Post('checkout')
  @UseGuards(SessionGuard)
  async checkout(
    @CurrentUser() user: User,
    @Body() rawBody: unknown,
  ): Promise<BillingRedirect> {
    const parsed = CheckoutRequestSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException({ code: 'validation_error' });

    return { url: await this.guarded(() => this.billing.checkout(user, parsed.data.plan)) };
  }

  /*
    Le portail de Stripe : moyen de paiement, factures, resiliation. Rien de
    tout cela n'a a etre reconstruit, et surtout pas une saisie de carte.
  */
  @Post('portal')
  @UseGuards(SessionGuard)
  async portal(@CurrentUser() user: User): Promise<BillingRedirect> {
    return { url: await this.guarded(() => this.billing.portal(user)) };
  }

  /*
    Le corps brut est indispensable : la signature se calcule sur les octets
    recus, que le JSON re-serialise par Nest ne reproduit pas. D'ou
    `rawBody: true` au demarrage.

    Une signature invalide vaut 400 : Stripe ne rejoue pas un 4xx, et l'appel
    ne vient pas de lui.
  */
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>): Promise<{ received: true }> {
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string' || !req.rawBody) {
      throw new BadRequestException({ code: 'invalid_signature' });
    }

    try {
      await this.billing.handle(req.rawBody, signature);
    } catch (error: unknown) {
      if (error instanceof BillingDisabledError) {
        throw new ServiceUnavailableException({ code: 'billing_disabled' });
      }

      // Le message de Stripe peut porter une partie de la charge utile : seul
      // le fait qu'elle soit refusee sort d'ici.
      this.logger.warn('signature de webhook refusee');
      throw new BadRequestException({ code: 'invalid_signature' });
    }

    return { received: true };
  }

  // Sans cle Stripe, la vente n'existe pas : c'est une indisponibilite, pas une erreur du joueur.
  private async guarded(run: () => Promise<string>): Promise<string> {
    try {
      return await run();
    } catch (error: unknown) {
      if (error instanceof BillingDisabledError) {
        throw new ServiceUnavailableException({ code: 'billing_disabled' });
      }
      throw error;
    }
  }
}
