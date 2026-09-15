import {Controller,Get,Headers,Post,UnauthorizedException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {RemindersService} from './reminders.service';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import {Roles} from '../auth/decorators/roles.decorator';
import {Public} from '../auth/decorators/public.decorator';
import type {AuthUser} from '../auth/auth.types';

@Controller('reminders')
export class RemindersController{
  constructor(private s:RemindersService,private config:ConfigService){}
  @Get('alerts') alerts(@CurrentUser()user:AuthUser){return this.s.alerts(user.organizationId)}
  @Roles('ADMIN','EDITOR') @Post('scan') scan(@CurrentUser()user:AuthUser){return this.s.scan(user.organizationId,user.sub)}
  @Public() @Post('cron') cron(@Headers('x-cron-secret')secret?:string){const expected=this.config.get<string>('CRON_SECRET');if(!expected||!secret||secret!==expected)throw new UnauthorizedException('Invalid cron secret');return this.s.scanAll()}
}
