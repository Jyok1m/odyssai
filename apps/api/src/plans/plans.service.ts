import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaClient, type Plan } from '@odyssai/db';
import { FREE_PLAN_SLUG } from '@odyssai/engine';
import { PRISMA } from '../prisma/prisma.module.js';

/**
 * Le palier libre est introuvable : la base n'a pas ete amorcee, ou quelqu'un
 * l'a supprime a la main. Rien ne peut fonctionner sans lui, et le dire vaut
 * mieux que servir une dotation inventee.
 */
export class MissingFreePlanError extends Error {
  constructor() {
    super(`le palier ${FREE_PLAN_SLUG} est absent de la table plans`);
    this.name = 'MissingFreePlanError';
  }
}

/**
 * Les paliers, lus en base.
 *
 * Ils vivaient en code, ce qui obligeait a deployer pour changer une dotation.
 * Ils sont desormais une donnee, editable depuis le tableau de bord
 * d'administration, et ce service est le seul a les lire.
 *
 * Pas de cache. Une lecture de plus par tour est negligeable devant l'appel au
 * modele qui suit, et un cache ferait vivre un joueur sur une dotation que
 * l'administrateur croit avoir changee.
 */
@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Tous les paliers, le palier libre d'abord, dans l'ordre choisi a la main. */
  async all(includeArchived = false): Promise<Plan[]> {
    return this.prisma.plan.findMany({
      where: includeArchived ? {} : { archived: false },
      orderBy: [{ archived: 'asc' }, { sortOrder: 'asc' }, { slug: 'asc' }],
    });
  }

  async free(): Promise<Plan> {
    const plan = await this.prisma.plan.findUnique({
      where: { slug: FREE_PLAN_SLUG },
    });

    if (!plan) throw new MissingFreePlanError();
    return plan;
  }

  /**
   * Le palier d'un abonnement.
   *
   * Un slug inconnu retombe sur le palier libre plutot que de faire echouer un
   * tour : la cle etrangere rend le cas impossible en temps normal, mais une
   * reserve servie est moins grave qu'une partie bloquee.
   */
  async bySlug(slug: string): Promise<Plan> {
    const plan = await this.prisma.plan.findUnique({ where: { slug } });
    if (plan) return plan;

    this.logger.warn(`palier inconnu, retour au palier libre : ${slug}`);
    return this.free();
  }

  /** Le chemin inverse : du prix rendu par un webhook vers notre palier. */
  async byPriceId(priceId: string): Promise<Plan | null> {
    if (!priceId) return null;
    return this.prisma.plan.findUnique({ where: { stripePriceId: priceId } });
  }

  /** En vente : un palier sans prix chez Stripe ne se souscrit pas. */
  async purchasable(): Promise<Plan[]> {
    return this.prisma.plan.findMany({
      where: { archived: false, stripePriceId: { not: null } },
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    });
  }
}
