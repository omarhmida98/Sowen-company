import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { StorageService } from '../storage/storage.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';

@Controller('system')
export class SystemController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly storage: StorageService,
  ) {}

  @Get('status')
  async status(@CurrentUser() user: AuthUser) {
    const admin = user.role === 'ADMIN';
    let database = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = true;
    } catch {
      // the reason stays in the server log (health check): it can name hosts and credentials
    }
    const storage = await this.storage.status();

    return {
      database,
      ai: Boolean(this.config.get<string>('ANTHROPIC_API_KEY')?.trim()),
      aiProvider: 'Claude',
      email: this.mailer.isConfigured(),
      emailProvider: this.mailer.provider(),
      // the sending address and technical details are shown to administrators only
      emailSender: admin ? this.mailer.sender() : null,
      // What is really in use: provider, whether it works, and why not when it does not.
      storage: admin ? storage : { ...storage, detail: null },
      automation: this.config.get('REMINDER_AUTOMATION_ENABLED') === 'true',
      digest: this.config.get('DAILY_DIGEST_ENABLED') === 'true',
    };
  }
}
