import { BadRequestException, Body, Controller, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsString } from 'class-validator';
import { ReportsService } from './reports.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/auth.types';
import { pdfUploadOptions } from '../common/upload-options';

class AnalyzeReportTextDto {
  @IsString() projectId!: string;
  @IsString() text!: string;
}

@Controller('reports')
export class ReportsController {
  constructor(private service: ReportsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) {
    return this.service.list(user.organizationId, projectId);
  }

  @Roles('ADMIN','EDITOR')
  @Post('analyze-text')
  analyzeText(@Body() dto: AnalyzeReportTextDto, @CurrentUser() user: AuthUser) {
    return this.service.analyzeText(dto.projectId, dto.text, user.organizationId);
  }

  @Roles('ADMIN','EDITOR')
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', pdfUploadOptions))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('projectId') projectId: string,
    @Query('issuer') issuer: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) throw new BadRequestException('file is required');
    if (!projectId) throw new BadRequestException('projectId is required');
    return this.service.uploadAndAnalyze(projectId, issuer, file, user.organizationId, user.sub);
  }

  @Roles('ADMIN','EDITOR')
  @Post(':reportId/reanalyze')
  reanalyze(@Param('reportId') reportId: string, @CurrentUser() user: AuthUser) {
    return this.service.reanalyze(reportId, user.organizationId, user.sub);
  }
}
