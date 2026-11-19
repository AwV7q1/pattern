import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@prisma/client';
import type { AppRequest } from '../common/types';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Reachable without signing in (the user is still attached when present). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AppRequest>().user;
});
