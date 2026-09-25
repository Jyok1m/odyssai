import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService, type Readiness } from './health.service.js';

/*
  Deux sondes, et la distinction compte.

  `/health` dit que le processus repond : c'est ce qu'on demande avant de
  conclure qu'il est fige. Il ne touche a rien, pour qu'une base tombee ne
  puisse pas faire redemarrer une api qui va bien.

  `/health/ready` dit qu'il peut servir un joueur, donc qu'il joint Redis et
  Postgres. C'est lui que docker interroge et, par lui, Traefik : le controle
  d'avant visait `/`, qui rend « Hello World! » sans rien consulter, de sorte
  qu'un conteneur dont la base etait injoignable se declarait sain et recevait
  du trafic.

  Ouvertes sans session : un controle de sante qui demande a s'authentifier ne
  peut pas servir a savoir si l'authentification fonctionne. Elles ne rendent
  qu'un etat par dependance, jamais la raison de l'echec.
*/
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /*
    503 et non 200 sur une dependance tombee : c'est le code qui fait le
    travail, docker et Traefik lisant le statut et non le corps. Le corps est
    pour la personne qui vient voir ce qui ne va pas.
  */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<Readiness> {
    const readiness = await this.health.ready();
    res.status(
      readiness.status === 'ok'
        ? HttpStatus.OK
        : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return readiness;
  }
}
