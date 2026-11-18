import { ForbiddenException, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import type { AppRequest } from '../common/types';
import { IS_PUBLIC, ROLES } from './decorators';
import { SESSION_COOKIE, SessionService } from './session.service';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-requested-with';

/**
 * CSRF: state-changing requests must carry `X-Requested-With`. Browsers do
 * not let another site add custom headers without a CORS preflight, which
 * we do not grant, so a forged form post or image request is refused. The
 * session cookie is also `SameSite=Lax`.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (SAFE.has(req.method)) return true;
    if (!req.headers[CSRF_HEADER]) throw new ForbiddenException('missing X-Requested-With header');
    return true;
  }
}

/** Attaches the signed-in user; refuses anonymous requests unless `@Public()`; checks `@Roles()`. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const user = await this.sessions.resolve(req.cookies?.[SESSION_COOKIE]);
    if (user) req.user = user;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (!user) throw new UnauthorizedException('sign in required');
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles?.length && !roles.includes(user.role)) throw new ForbiddenException('not allowed');
    return true;
  }
}
