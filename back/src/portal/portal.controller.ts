import {BadRequestException,Body,Controller,Delete,Get,HttpCode,Param,Post,Query,UploadedFile,UseInterceptors} from '@nestjs/common';
import {IsOptional,IsString,MaxLength} from 'class-validator';
import {FileInterceptor} from '@nestjs/platform-express';
import {PortalService} from './portal.service';
import {Public} from '../auth/decorators/public.decorator';
import {Roles} from '../auth/decorators/roles.decorator';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import type {AuthUser} from '../auth/auth.types';
import {generalUploadOptions} from '../common/upload-options';
class CreatePortalDto{@IsString()companyId!:string;@IsString()projectId!:string;@IsOptional()@IsString()expiresAt?:string}
class PortalResponseDto{@IsString()@MaxLength(100)observationId!:string;@IsOptional()@IsString()@MaxLength(4000)message?:string;@IsOptional()@IsString()@MaxLength(4000)note?:string}
@Controller('portal')
export class PortalController{
  constructor(private s:PortalService){}
  // ---- internal management (administrators and editors) ----
  @Roles('ADMIN','EDITOR') @Get('access') list(@Query('projectId')projectId:string,@Query('companyId')companyId:string|undefined,@CurrentUser()user:AuthUser){if(!projectId)throw new BadRequestException('projectId is required');return this.s.list(projectId,companyId||undefined,user.organizationId)}
  @Roles('ADMIN','EDITOR') @Post('access') create(@Body()d:CreatePortalDto,@CurrentUser()user:AuthUser){return this.s.create(d.companyId,d.projectId,d.expiresAt,user.organizationId,user.sub)}
  @Roles('ADMIN','EDITOR') @Post('access/:id/regenerate') @HttpCode(200) regenerate(@Param('id')id:string,@CurrentUser()user:AuthUser){return this.s.regenerate(id,user.organizationId,user.sub)}
  @Roles('ADMIN','EDITOR') @Delete('access/:id') revoke(@Param('id')id:string,@CurrentUser()user:AuthUser){return this.s.revoke(id,user.organizationId,user.sub)}
  // ---- the company, identified only by its link ----
  @Public() @Get(':token') get(@Param('token')t:string){return this.s.get(t)}
  @Public() @Post(':token/response') response(@Param('token')token:string,@Body()body:PortalResponseDto){return this.s.addResponse(token,body.observationId,body.message??body.note??'')}
  @Public() @Post(':token/evidence') @UseInterceptors(FileInterceptor('file',generalUploadOptions))
  uploadEvidence(@Param('token')token:string,@UploadedFile()file:Express.Multer.File,@Query('observationId')observationId:string,@Query('type')type='OTHER',@Query('note')note?:string){if(!file||!observationId)throw new BadRequestException('file and observationId are required');return this.s.uploadEvidence(token,observationId,type,note,file)}
  @Public() @Get(':token/evidence/:evidenceId/file') download(@Param('token')token:string,@Param('evidenceId')evidenceId:string){return this.s.downloadEvidence(token,evidenceId)}
}
