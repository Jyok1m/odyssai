import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Put,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  OnboardingUpdateSchema,
  type DepartureOutcome,
  type OnboardingState,
} from '@odyssai/schemas';
import type { User } from '@odyssai/db';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ErasureService } from '../erasure/erasure.service.js';
import {
  IncompleteError,
  LockedError,
  OnboardingService,
  WrongStepError,
} from './onboarding.service.js';

/**
 * Le parcours d'entree en jeu, de bout en bout dans une seule ressource. Un
 * appel suffit a reprendre exactement la ou le joueur s'etait arrete, et
 * chaque saisie s'enregistre sans attendre qu'elle soit complete.
 *
 * Le pseudo n'est pas ici : il appartient au profil, et PATCH /me le pose.
 */
@Controller('onboarding')
@UseGuards(SessionGuard)
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly erasure: ErasureService,
  ) {}

  @Get()
  state(@CurrentUser() user: User): Promise<OnboardingState> {
    return this.onboarding.getState(user);
  }

  /**
   * Recommencer. Le monde et le personnage sont traites selon la regle du
   * depart, puis le joueur repart a l'etape inspiration.
   *
   * Refuse pendant la generation, comme les ecritures le sont : effacer un
   * monde qu'un worker est en train d'ecrire le ferait echouer sur une ligne
   * disparue plutot que de l'arreter proprement.
   */
  @Delete()
  async restart(@CurrentUser() user: User): Promise<DepartureOutcome> {
    const state = await this.onboarding.getState(user);
    if (state.step === 'generating') {
      throw new ConflictException({ code: 'locked' });
    }

    return this.erasure.releaseWorld(user.id);
  }

  @Put()
  async save(
    @CurrentUser() user: User,
    @Body() rawBody: unknown,
  ): Promise<OnboardingState> {
    const parsed = OnboardingUpdateSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'validation_error' });
    }

    try {
      return await this.onboarding.save(user, parsed.data);
    } catch (error: unknown) {
      if (error instanceof WrongStepError) {
        throw new ConflictException({ code: 'wrong_step' });
      }
      if (error instanceof LockedError) {
        throw new ConflictException({ code: 'locked' });
      }
      // 422 et non 409 : la saisie est ecrite, c'est le passage a l'etape
      // suivante qui est refuse, et le front doit pouvoir les distinguer.
      if (error instanceof IncompleteError) {
        throw new UnprocessableEntityException({ code: 'incomplete' });
      }
      throw error;
    }
  }
}
