import {BadRequestException,Body,Controller,Delete,Get,Param,Post,Query,UploadedFile,UseInterceptors} from '@nestjs/common';
import {IsOptional,IsString} from 'class-validator';
import {FileInterceptor} from '@nestjs/platform-express';
import {PortalService} from './portal.service';
import {Public} from '../auth/decorators/public.decorator';
import {Roles} from '../auth/decorators/roles.decorator';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import type {AuthUser} from '../auth/auth.types';
import {generalUploadOptions} from '../common/upload-options';
class CreatePortalDto{@IsString()companyId!:string;@IsString()projectId!:string;@IsOptional()@IsString()expiresAt?:string}
@Controller('portal')
export class PortalController{
  constructor(private s:PortalService){}
  @Roles('ADMIN','EDITOR') @Post('access') create(@Body()d:CreatePortalDto,@CurrentUser()user:AuthUser){return this.s.create(d.companyId,d.projectId,d.expiresAt,user.organizationId,user.sub)}
  @Roles('ADMIN','EDITOR') @Delete('access/:id') revoke(@Param('id')id:string,@CurrentUser()user:AuthUser){return this.s.revoke(id,user.organizationId,user.sub)}
  @Public() @Get(':token') get(@Param('token')t:string){return this.s.get(t)}
  @Public() @Post(':token/response') response(@Param('token')token:string,@Body()body:{observationId:string;note:string}){if(!body?.observationId||!body?.note?.trim())throw new BadRequestException('observationId and note are required');return this.s.addResponse(token,body.observationId,body.note.trim())}
  @Public() @Post(':token/evidence') @UseInterceptors(FileInterceptor('file',generalUploadOptions))
  uploadEvidence(@Param('token')token:string,@UploadedFile()file:Express.Multer.File,@Query('observationId')observationId:string,@Query('type')type='OTHER',@Query('note')note?:string){if(!file||!observationId)throw new BadRequestException('file and observationId are required');return this.s.uploadEvidence(token,observationId,type,note,file)}
}
