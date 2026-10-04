import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RulesService } from './rules.service';
import { RuleDto, UpdateRuleDto } from './rules.dto';
import { MAX_IMPORT_BYTES } from './rule-csv';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/auth.types';

const csvUpload = { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } };

// Everyone in the organisation reads its rules; administrators and editors manage them.
@Controller('rules')
export class RulesController {
  constructor(private service: RulesService) {}
  @Get() list(@CurrentUser() user: AuthUser) { return this.service.list(user.organizationId); }
  @Get('summary') summary(@CurrentUser() user: AuthUser) { return this.service.summary(user.organizationId); }
  @Roles('ADMIN', 'EDITOR') @Get('import/template') @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="modele-regles-sowen.csv"')
  template() { return this.service.template(); }
  @Roles('ADMIN', 'EDITOR') @Post('import/preview') @HttpCode(200) @UseInterceptors(FileInterceptor('file', csvUpload))
  preview(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthUser) { return this.service.preview(file, user.organizationId); }
  @Roles('ADMIN', 'EDITOR') @Post('import') @UseInterceptors(FileInterceptor('file', csvUpload))
  import(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthUser) { return this.service.import(file, user.organizationId, user.sub); }
  @Get(':id') get(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.get(id, user.organizationId); }
  @Roles('ADMIN', 'EDITOR') @Post() create(@Body() dto: RuleDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.organizationId, user.sub); }
  @Roles('ADMIN', 'EDITOR') @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateRuleDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.organizationId, user.sub); }
  @Roles('ADMIN', 'EDITOR') @Delete(':id') remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.organizationId, user.sub); }
}
