import { BadRequestException, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/auth.types';
import { generalUploadOptions } from '../common/upload-options';
@Controller('documents')
export class DocumentsController {
  constructor(private service: DocumentsService) {}
  @Get() list(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) { return this.service.list(user.organizationId, projectId); }
  @Roles('ADMIN','EDITOR') @Post('upload')
  @UseInterceptors(FileInterceptor('file', generalUploadOptions))
  upload(@UploadedFile() file: Express.Multer.File, @Query('projectId') projectId: string, @Query('type') type = 'OTHER', @CurrentUser() user: AuthUser) {
    if (!file) throw new BadRequestException('file is required');
    if (!projectId) throw new BadRequestException('projectId is required');
    return this.service.upload(projectId, type, file, user.organizationId, user.sub);
  }
  @Get(':id/file') download(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.download(id, user.organizationId); }
  @Roles('ADMIN','EDITOR') @Delete(':id') remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.organizationId, user.sub); }
}
