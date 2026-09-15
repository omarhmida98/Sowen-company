import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { BuildingType } from '@prisma/client';
import { RulesService } from './rules.service';
import { CreateRuleDto } from './rules.dto';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import {Roles} from '../auth/decorators/roles.decorator';
import type {AuthUser} from '../auth/auth.types';
@Controller('rules')
export class RulesController {
  constructor(private service: RulesService) {}
  @Get() list(@Query('domain') domain?: string, @Query('buildingType') buildingType?: BuildingType, @Query('erpType') erpType?: string, @Query('lotId') lotId?: string) { return this.service.list({ domain, buildingType, erpType, lotId }); }
  @Get(':id') get(@Param('id') id: string) { return this.service.get(id); }
  @Roles('ADMIN') @Post() create(@Body() dto: CreateRuleDto,@CurrentUser()user:AuthUser) { return this.service.create(dto,user.sub); }
  @Roles('ADMIN') @Post(':id/versions') version(@Param('id') id: string, @Body() body: { requirement:string; actionRequest?:string; effectiveFrom?:string },@CurrentUser()user:AuthUser) { return this.service.addVersion(id, body,user.sub); }
  @Roles('ADMIN') @Delete(':id') archive(@Param('id') id: string,@CurrentUser()user:AuthUser) { return this.service.archive(id,user.sub); }
}
