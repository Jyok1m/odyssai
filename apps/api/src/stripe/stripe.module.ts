import { Global, Module } from '@nestjs/common';
import Stripe from 'stripe';
import { BillingConfig } from '../config/billing-config.js';

export const STRIPE = Symbol('STRIPE');

/*
  Le client Stripe, ou `null`.

  Un seul endroit le construit : trois services l'utilisent desormais, et
  trois `new Stripe(...)` finiraient par diverger sur la version d'API, ce qui
  se verrait au pire moment. `null` quand aucune cle n'est configuree, ce qui
  est un etat normal : le palier libre suffit a jouer.
*/
@Global()
@Module({
  providers: [
    {
      provide: STRIPE,
      inject: [BillingConfig],
      useFactory: (config: BillingConfig): Stripe | null =>
        config.enabled
          ? new Stripe(config.secretKey, { apiVersion: '2026-08-26.dahlia' })
          : null,
    },
  ],
  exports: [STRIPE],
})
export class StripeModule {}
