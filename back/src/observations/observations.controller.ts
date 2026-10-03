import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ObservationsService } from './observations.service';
import { AddResponseDto, AssignObservationDto, CloseObservationDto, CreateObservationDto, ReviewObservationDto, TransitionObservationDto, UpdateObservationDto } from './observations.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/auth.types';

@Controller('observations')
export class ObservationsController {
  constructor(private service: ObservationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('projectId') projectId?: string) { return this.service.list(user.organizationId, projectId); }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.get(id, user.organizationId); }

  @Roles('ADMIN','EDITOR') @Post()
  create(@Body() dto: CreateObservationDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.organizationId, user.sub); }

  @Roles('ADMIN','EDITOR') @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateObservationDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.organizationId, user.sub); }

  @Roles('ADMIN','EDITOR') @Post(':id/review')
  review(@Param('id') id: string, @Body() dto: ReviewObservationDto, @CurrentUser() user: AuthUser) { return this.service.review(id, dto, user.organizationId, user.sub); }

  @Roles('ADMIN','EDITOR') @Post(':id/status')
  transition(@Param('id') id: string, @Body() dto: TransitionObservationDto, @CurrentUser() user: AuthUser) { return this.service.transition(id, dto, user.organizationId, user.sub); }

  @Roles('ADMIN','EDITOR') @Post(':id/responses')
  addResponse(@Param('id') id: string, @Body() dto: AddResponseDto, @CurrentUser() user: AuthUser) { return this.service.addResponse(id, dto, user.organizationId, user.sub); }

  @Roles('ADMIN','EDITOR') @Post(':id/close')
  close(@Param('id') id: string, @Body() dto: CloseObservationDto, @CurrentUser() user: AuthUser) { return this.service.close(id, dto, user.organizationId, user.sub); }

  @Roles('ADMIN','EDITOR') @Post(':id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignObservationDto, @CurrentUser() user: AuthUser) { return this.service.assign(id, dto, user.organizationId, user.sub); }

  @Roles('ADMIN','EDITOR') @Delete(':id/assign/:userId')
  unassign(@Param('id') id: string, @Param('userId') assigneeId: string, @CurrentUser() user: AuthUser) { return this.service.unassign(id, assigneeId, user.organizationId, user.sub); }
}
