import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, UpdateProjectDto } from './projects.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/auth.types';
@Controller('projects')
export class ProjectsController {
  constructor(private service: ProjectsService) {}
  @Get() list(@CurrentUser() user: AuthUser) { return this.service.list(user.organizationId); }
  @Get(':id') get(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.get(id, user.organizationId); }
  @Roles('ADMIN','EDITOR') @Post() create(@Body() dto: CreateProjectDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.organizationId, user.sub); }
  @Roles('ADMIN','EDITOR') @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateProjectDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.organizationId, user.sub); }
  @Roles('ADMIN') @Delete(':id') remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.organizationId); }
}
