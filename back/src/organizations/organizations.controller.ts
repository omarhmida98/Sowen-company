import {Body,Controller,Get,Patch}from'@nestjs/common';
import{IsEmail,IsInt,IsOptional,IsString,Min}from'class-validator';
import{OrganizationsService}from'./organizations.service';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import {Roles} from '../auth/decorators/roles.decorator';
import type {AuthUser} from '../auth/auth.types';
class UpdateOrgDto{@IsOptional()@IsString()name?:string;@IsOptional()@IsEmail()senderEmail?:string;@IsOptional()@IsInt()@Min(1)reminderDays?:number;@IsOptional()@IsInt()@Min(1)dueSoonDays?:number;@IsOptional()@IsInt()@Min(1)escalationDays?:number;}
@Controller('organizations')export class OrganizationsController{constructor(private service:OrganizationsService){}@Get('me')get(@CurrentUser()user:AuthUser){return this.service.get(user.organizationId)}@Roles('ADMIN')@Patch('me')update(@CurrentUser()user:AuthUser,@Body()d:UpdateOrgDto){return this.service.update(user.organizationId,d,user.sub)}}
