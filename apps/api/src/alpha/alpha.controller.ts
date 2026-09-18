import { Controller, Get } from '@nestjs/common';
import type { AlphaStatus } from '@odyssai/schemas';
import { AlphaService } from './alpha.service.js';

/**
 * L'etat de l'alpha, public et sans session.
 *
 * Comme le catalogue des paliers : le site doit pouvoir l'afficher avant que
 * qui que ce soit se connecte, et il n'y a rien de personnel dedans. Les
 * ecritures, elles, vivent sous /admin, derriere les deux gardes.
 */
@Controller('alpha')
export class AlphaController {
  constructor(private readonly alpha: AlphaService) {}

  @Get()
  status(): Promise<AlphaStatus> {
    return this.alpha.status();
  }
}
