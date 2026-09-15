import {BadRequestException,Body,Controller,Get,Param,Patch,Post,Query,UploadedFile,UseInterceptors} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {EvidenceService} from './evidence.service';
import {ReviewEvidenceDto} from './evidence.dto';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import {Roles} from '../auth/decorators/roles.decorator';
import type {AuthUser} from '../auth/auth.types';
import {generalUploadOptions} from '../common/upload-options';

@Controller('evidence')
export class EvidenceController{
  constructor(private s:EvidenceService){}

  @Get()
  list(@Query('observationId') id:string,@CurrentUser() user:AuthUser){return this.s.list(id,user.organizationId)}

  @Roles('ADMIN','EDITOR') @Post('upload') @UseInterceptors(FileInterceptor('file',generalUploadOptions))
  upload(@UploadedFile()file:Express.Multer.File,@Query('observationId')id:string,@Query('type')type='OTHER',@Query('note')note:string|undefined,@CurrentUser()user:AuthUser){
    if(!file||!id)throw new BadRequestException('file and observationId are required');
    return this.s.upload(id,type,note,file,user.organizationId,user.sub)
  }

  @Roles('ADMIN','EDITOR') @Patch(':id/review')
  review(@Param('id')id:string,@Body()dto:ReviewEvidenceDto,@CurrentUser()user:AuthUser){
    return this.s.review(id,dto.status,dto.note,user.organizationId,user.sub)
  }
}
