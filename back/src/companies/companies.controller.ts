import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './companies.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/auth.types';
@Controller('companies')
export class CompaniesController {
  constructor(private service: CompaniesService) {}
  @Get() list(@CurrentUser() user: AuthUser) { return this.service.list(user.organizationId); }
  @Roles('ADMIN','EDITOR') @Post() create(@Body() dto: CreateCompanyDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.organizationId, user.sub); }
  @Roles('ADMIN') @Delete(':id') remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.organizationId); }
}
