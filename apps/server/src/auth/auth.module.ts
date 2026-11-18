import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalProvider } from './providers/local.provider';
import { SessionService } from './session.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, LocalProvider],
  exports: [AuthService, SessionService],
})
export class AuthModule {}
