import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { StorageService } from '../storage/storage.service';

@Controller('system')
export class SystemController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly storage: StorageService,
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
      ai: Boolean(this.config.get<string>('ANTHROPIC_API_KEY')?.trim()),
      aiProvider: 'Claude',
      email: this.mailer.isConfigured(),
      emailProvider: this.mailer.provider(),
      emailSender: this.mailer.sender(),
      // What is really in use: provider, whether it works, and why not when it does not.
      storage: await this.storage.status(),
      automation: this.config.get('REMINDER_AUTOMATION_ENABLED') === 'true',
      digest: this.config.get('DAILY_DIGEST_ENABLED') === 'true',
    };
  }
}
