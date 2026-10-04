import {Controller,Get,Headers,Post,Query,UnauthorizedException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {createHash,timingSafeEqual} from 'crypto';
import {RemindersService} from './reminders.service';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import {Roles} from '../auth/decorators/roles.decorator';
import {Public} from '../auth/decorators/public.decorator';
import type {AuthUser} from '../auth/auth.types';

@Controller('reminders')
export class RemindersController{
  constructor(private s:RemindersService,private config:ConfigService){}
  @Get('alerts') alerts(@CurrentUser()user:AuthUser){return this.s.alerts(user.organizationId)}
  @Roles('ADMIN','EDITOR') @Post('scan') scan(@CurrentUser()user:AuthUser,@Query('dryRun')dryRun?:string){return this.s.scan(user.organizationId,user.sub,{trigger:'manual',dryRun:dryRun==='true'})}
  @Public() @Post('cron') cron(@Headers('x-cron-secret')secret?:string,@Query('dryRun')dryRun?:string){const expected=(this.config.get<string>('CRON_SECRET')||'').trim();const digest=(v:string)=>createHash('sha256').update(v).digest();if(!expected||!secret||!timingSafeEqual(digest(secret),digest(expected)))throw new UnauthorizedException('Invalid cron secret');return this.s.scanAll({dryRun:dryRun==='true'})}
}
