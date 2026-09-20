import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Controller('system')
export class SystemController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('status')
  async status() {
    let database = false;
    let databaseError: string | null = null;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = true;
    } catch (error) {
      databaseError = error instanceof Error ? error.message : 'Database connection failed';
    }

    return {
      database,
      databaseError,
      gemini: Boolean(this.config.get('GEMINI_API_KEY')),
      resend: Boolean(this.config.get('RESEND_API_KEY') && this.config.get('RESEND_FROM')),
      storage: Boolean(
        this.config.get('S3_BUCKET') &&
        this.config.get('S3_ACCESS_KEY_ID') &&
        this.config.get('S3_SECRET_ACCESS_KEY'),
      ),
      automation: this.config.get('REMINDER_AUTOMATION_ENABLED') === 'true',
      digest: this.config.get('DAILY_DIGEST_ENABLED') === 'true',
    };
  }
}
