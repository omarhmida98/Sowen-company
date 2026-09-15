import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { EmailsService } from './emails.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { AuthUser } from '../auth/auth.types';
@Controller('emails')
export class EmailsController {
  constructor(private service: EmailsService) {}
  @Get() list(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) { return this.service.list(user.organizationId, projectId); }
  @Roles('ADMIN','EDITOR') @Post('send-drafts') sendDrafts(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) { return this.service.sendDrafts(user.organizationId, user.sub, projectId); }
  @Roles('ADMIN','EDITOR') @Post(':id/send') send(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.send(id, user.organizationId, user.sub); }
  @Roles('ADMIN','EDITOR') @Post(':id/remind') remind(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remind(id, user.organizationId, user.sub); }
  @Public() @Post('resolve/:token') resolve(@Param('token') token: string) { return this.service.resolve(token); }
}
