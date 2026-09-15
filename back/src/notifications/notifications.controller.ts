import {Controller,Get,Param,Post,Query} from '@nestjs/common';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import {Roles} from '../auth/decorators/roles.decorator';
import type {AuthUser} from '../auth/auth.types';
import {NotificationsService} from './notifications.service';

@Controller('notifications')
export class NotificationsController{
  constructor(private s:NotificationsService){}
  @Get() list(@CurrentUser()u:AuthUser,@Query('unread')unread?:string){return this.s.list(u.sub,u.organizationId,unread==='true')}
  @Get('summary') summary(@CurrentUser()u:AuthUser){return this.s.summary(u.sub,u.organizationId)}
  @Post(':id/read') read(@Param('id')id:string,@CurrentUser()u:AuthUser){return this.s.markRead(id,u.sub)}
  @Post('read-all') readAll(@CurrentUser()u:AuthUser){return this.s.markAllRead(u.sub)}
  @Roles('ADMIN','EDITOR') @Post('digest/send') digest(@CurrentUser()u:AuthUser){return this.s.sendDigestForOrganization(u.organizationId)}
}
