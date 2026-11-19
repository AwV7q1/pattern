import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { EngineService } from '../engine/engine.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: PrismaService,
    private readonly engine: EngineService,
  ) {}

  @Public()
  @Get()
  async check() {
    try {
      await this.db.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'down' });
    }
    return { status: 'ok', db: 'up', engine: this.engine.stats };
  }
}
