import { Injectable } from '@nestjs/common';
import type { AuthProvider } from './auth-provider';

/** Email + password, checked against `Identity.passwordHash` (argon2id). */
@Injectable()
export class LocalProvider implements AuthProvider {
  readonly info = { id: 'local', name: 'Email và mật khẩu', kind: 'password' as const };

  static subjectOf(email: string) {
    return email.trim().toLowerCase();
  }
}
