import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/config';
import type { AuthUser } from '../common/types';

export const SESSION_COOKIE = 'pattern_sid';
const TOUCH_EVERY_MS = 5 * 60_000;

const digest = (token: string) => createHash('sha256').update(token).digest('base64url');

@Injectable()
export class SessionService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: AppConfig,
  ) {}

  get ttlMs() {
    return this.config.get('SESSION_TTL_DAYS') * 86_400_000;
  }

  /** New session; returns the token for the cookie (only its hash is stored). */
  async create(userId: string, meta: { userAgent?: string; ip?: string }) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs);
    await this.db.session.create({
      data: { id: digest(token), userId, expiresAt, userAgent: meta.userAgent?.slice(0, 300), ip: meta.ip },
    });
    // opportunistic cleanup, cheap at this scale
    await this.db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return { token, expiresAt };
  }

  /** User behind a cookie token, or null. Sliding expiry, written at most every 5 minutes. */
  async resolve(token: string | undefined): Promise<AuthUser | null> {
    if (!token || token.length > 100) return null;
    const id = digest(token);
    const s = await this.db.session.findUnique({ where: { id }, include: { user: true } });
    if (!s || s.expiresAt.getTime() < Date.now()) return null;
    if (Date.now() - s.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      await this.db.session.update({
        where: { id },
        data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + this.ttlMs) },
      });
    }
    const { user } = s;
    return { id: user.id, email: user.email, displayName: user.displayName, role: user.role, sessionId: id };
  }

  list(userId: string) {
    return this.db.session.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      select: { id: true, createdAt: true, lastSeenAt: true, userAgent: true, ip: true },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async revoke(userId: string, id: string) {
    const { count } = await this.db.session.deleteMany({ where: { id, userId } });
    return count > 0;
  }

  revokeAll(userId: string, except?: string) {
    return this.db.session.deleteMany({ where: { userId, ...(except ? { id: { not: except } } : {}) } });
  }
}
