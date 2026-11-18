import type { Request } from 'express';
import type { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  /** Hash of the session token (id of the `Session` row). */
  sessionId: string;
}

export type AppRequest = Request & { user?: AuthUser };
