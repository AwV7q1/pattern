import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig } from '../config/config';
import { hashPassword, verifyPassword } from './password';
import { LocalProvider } from './providers/local.provider';
import type { ResolvedIdentity } from './providers/auth-provider';

export const publicUser = (u: Pick<User, 'id' | 'email' | 'displayName' | 'role'>) => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  role: u.role,
});

@Injectable()
export class AuthService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: AppConfig,
  ) {}

  get signupAllowed() {
    return this.config.get('ALLOW_SIGNUP');
  }

  /** Create a user with a local password (signup, CLI, tests). */
  async createUser(input: { email: string; password: string; displayName?: string; role?: Role }) {
    const subject = LocalProvider.subjectOf(input.email);
    const exists = await this.db.user.findUnique({ where: { email: subject } });
    if (exists) throw new ConflictException('email đã được dùng');
    return this.db.user.create({
      data: {
        email: subject,
        displayName: input.displayName?.trim() || subject.split('@')[0],
        role: input.role ?? 'user',
        identities: { create: { provider: 'local', subject, passwordHash: await hashPassword(input.password) } },
      },
    });
  }

  async signup(input: { email: string; password: string; displayName?: string }) {
    if (!this.signupAllowed) throw new ForbiddenException('đăng ký đang tắt, nhờ quản trị viên tạo tài khoản');
    // the very first account administers the instance
    const first = (await this.db.user.count()) === 0;
    return this.createUser({ ...input, role: first ? 'admin' : 'user' });
  }

  async login(email: string, password: string) {
    const subject = LocalProvider.subjectOf(email);
    const identity = await this.db.identity.findUnique({
      where: { provider_subject: { provider: 'local', subject } },
      include: { user: true },
    });
    const ok = await verifyPassword(identity?.passwordHash, password);
    if (!identity || !ok) throw new UnauthorizedException('sai email hoặc mật khẩu');
    await this.db.identity.update({ where: { id: identity.id }, data: { lastUsedAt: new Date() } });
    return identity.user;
  }

  /**
   * Sign in through an external provider (OIDC/SSO): reuse the linked user,
   * or link by verified email, or create one. Not wired to a route yet.
   */
  async signInExternal(id: ResolvedIdentity) {
    const linked = await this.db.identity.findUnique({
      where: { provider_subject: { provider: id.provider, subject: id.subject } },
      include: { user: true },
    });
    if (linked) return linked.user;
    const email = id.email.trim().toLowerCase();
    const user =
      (await this.db.user.findUnique({ where: { email } })) ??
      (await this.db.user.create({ data: { email, displayName: id.displayName ?? email.split('@')[0] } }));
    await this.db.identity.create({ data: { userId: user.id, provider: id.provider, subject: id.subject } });
    return user;
  }

  async changePassword(userId: string, current: string, next: string) {
    const identity = await this.db.identity.findFirst({ where: { userId, provider: 'local' } });
    if (!identity || !(await verifyPassword(identity.passwordHash, current))) throw new UnauthorizedException('mật khẩu hiện tại không đúng');
    await this.db.identity.update({ where: { id: identity.id }, data: { passwordHash: await hashPassword(next) } });
  }

  updateProfile(userId: string, displayName: string) {
    return this.db.user.update({ where: { id: userId }, data: { displayName: displayName.trim() } });
  }
}
