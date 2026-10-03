import { Module } from '@nestjs/common';
import { EmailsController } from './emails.controller';
import { EmailsService } from './emails.service';
import { PortalModule } from '../portal/portal.module';
@Module({ imports: [PortalModule], controllers: [EmailsController], providers: [EmailsService] })
export class EmailsModule {}
