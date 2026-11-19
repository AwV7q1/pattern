import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AppRequest } from './types';

/** Limits per signed-in user (several users may share an IP behind NAT), else per IP. */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const r = req as unknown as AppRequest;
    return r.user ? `u:${r.user.id}` : `ip:${r.ip}`;
  }
}
