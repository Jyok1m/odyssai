import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppConfig } from '../config/app-config.js';
import type { User } from '../generated/prisma/client.js';
import { UsersService } from '../users/users.service.js';
import { SessionService, type StoredSession } from './session.service.js';

export interface AuthenticatedRequest extends Request {
  odyssaiSession: StoredSession;
  odyssaiUser: User;
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
    private readonly users: UsersService,
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
    // Resolution par `sub` et non par `userId` : une lecture sur un index
    // unique dans les deux cas, mais celle-ci recree la ligne si elle manque.
    request.odyssaiUser = await this.users.resolve({
      keycloakId: session.sub,
      email: session.email,
      emailVerified: session.emailVerified,
    });
    return true;
  }
}
