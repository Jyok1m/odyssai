import { Global, Module } from '@nestjs/common';
import { MailConfig } from '../config/mail-config.js';
import { MailService } from './mail.service.js';

/**
 * Global comme StripeModule : un seul transporteur pour toute l'application,
 * et les futurs envois n'auront pas a l'importer chacun de leur cote.
 */
@Global()
@Module({
  providers: [MailConfig, MailService],
  exports: [MailService, MailConfig],
})
export class MailModule {}
