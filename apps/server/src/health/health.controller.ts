import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Build version — updated on each server restart
const BUILD_VERSION = Date.now().toString(36);

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'ok', timestamp: new Date().toISOString() };
    } catch {
      return { status: 'error', db: 'error', timestamp: new Date().toISOString() };
    }
  }

  @Get('version')
  getVersion() {
    return { version: BUILD_VERSION, timestamp: new Date().toISOString() };
  }
}
