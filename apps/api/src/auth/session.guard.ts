import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppConfig } from '../config/app-config.js';
import { SessionService, type StoredSession } from './session.service.js';

export interface AuthenticatedRequest extends Request {
  odyssaiSession: StoredSession;
}

/**
 * Resout la session serveur depuis le cookie opaque et la depose sur la
 * requete : les controleurs de jeu n'ont jamais a manipuler de jeton.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly config: AppConfig,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const jar = request.cookies as Record<string, unknown> | undefined;
    const sessionId = jar?.[this.config.cookies.session];

    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new UnauthorizedException('Session absente');
    }

    const session = await this.sessions.read(sessionId);
    if (!session) {
      throw new UnauthorizedException('Session expiree');
    }

    request.odyssaiSession = session;
    return true;
  }
}
