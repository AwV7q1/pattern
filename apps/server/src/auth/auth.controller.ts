import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AppRequest, AuthUser } from '../common/types';
import { AppConfig } from '../config/config';
import { AuthService, publicUser } from './auth.service';
import { CurrentUser, Public } from './decorators';
import { ChangePasswordDto, LoginDto, SignupDto, UpdateProfileDto } from './dto';
import { LocalProvider } from './providers/local.provider';
import { SESSION_COOKIE, SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly config: AppConfig,
    private readonly local: LocalProvider,
  ) {}

  private async startSession(req: AppRequest, res: Response, userId: string) {
    const { token, expiresAt } = await this.sessions.create(userId, { userAgent: req.headers['user-agent'], ip: req.ip });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('COOKIE_SECURE'),
      path: '/',
      expires: expiresAt,
    });
  }

  /** What the login page can offer: providers and whether signup is open. */
  @Public()
  @Get('providers')
  providers() {
    return { providers: [this.local.info], signup: this.auth.signupAllowed };
  }

  @Public()
  @Get('me')
  me(@CurrentUser() user?: AuthUser) {
    return { user: user ? publicUser(user) : null };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('signup')
  async signup(@Body() dto: SignupDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.signup(dto);
    await this.startSession(req, res, user.id);
    return { user: publicUser(user) };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.login(dto.email, dto.password);
    await this.startSession(req, res, user.id);
    return { user: publicUser(user) };
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@CurrentUser() user: AuthUser | undefined, @Res({ passthrough: true }) res: Response) {
    if (user) await this.sessions.revoke(user.id, user.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Patch('me')
  async updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return { user: publicUser(await this.auth.updateProfile(user.id, dto.displayName)) };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(204)
  @Post('password')
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user.id, dto.current, dto.next);
    // other devices must sign in again with the new password
    await this.sessions.revokeAll(user.id, user.sessionId);
  }

  @Get('sessions')
  async listSessions(@CurrentUser() user: AuthUser) {
    const list = await this.sessions.list(user.id);
    return list.map((s) => ({ ...s, current: s.id === user.sessionId }));
  }

  @HttpCode(204)
  @Delete('sessions/:id')
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (!(await this.sessions.revoke(user.id, id))) throw new NotFoundException('session not found');
  }
}
