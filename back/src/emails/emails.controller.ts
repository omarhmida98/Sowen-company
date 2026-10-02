import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { EmailsService } from './emails.service';
import { ObservationEmailDto, SendObservationEmailDto } from './emails.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { AuthUser } from '../auth/auth.types';
@Controller('emails')
export class EmailsController {
  constructor(private service: EmailsService) {}
  @Get() list(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) { return this.service.list(user.organizationId, projectId); }
  @Roles('ADMIN','EDITOR') @Get('observation/:observationId/compose') compose(@Param('observationId') observationId: string, @CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) { return this.service.compose(observationId, user.organizationId, companyId || undefined); }
  @Roles('ADMIN','EDITOR') @Put('observation/:observationId/draft') saveDraft(@Param('observationId') observationId: string, @Body() dto: ObservationEmailDto, @CurrentUser() user: AuthUser) { return this.service.saveDraft(observationId, dto, user.organizationId, user.sub); }
  @Roles('ADMIN','EDITOR') @Post('observation/:observationId/send') sendToCompany(@Param('observationId') observationId: string, @Body() dto: SendObservationEmailDto, @CurrentUser() user: AuthUser) { return this.service.sendToCompany(observationId, dto, user.organizationId, user.sub); }
  @Roles('ADMIN','EDITOR') @Post('send-drafts') sendDrafts(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) { return this.service.sendDrafts(user.organizationId, user.sub, projectId); }
  @Roles('ADMIN','EDITOR') @Post(':id/send') send(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.send(id, user.organizationId, user.sub); }
  @Roles('ADMIN','EDITOR') @Post(':id/remind') remind(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remind(id, user.organizationId, user.sub); }
  @Public() @Post('resolve/:token') resolve(@Param('token') token: string) { return this.service.resolve(token); }
}
