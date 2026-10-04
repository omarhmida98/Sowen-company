import {Controller,Get,Query} from '@nestjs/common';
import {ActivityService} from './activity.service';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import type {AuthUser} from '../auth/auth.types';
@Controller('activity')
export class ActivityController{constructor(private service:ActivityService){}@Get()list(@CurrentUser()user:AuthUser,@Query('projectId')projectId?:string){return this.service.list(user.organizationId,projectId,user.role)}}
