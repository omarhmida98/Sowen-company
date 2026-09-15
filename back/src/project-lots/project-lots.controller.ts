import {Body,Controller,Delete,Param,Post} from '@nestjs/common';
import {ProjectLotsService} from './project-lots.service';
import {CreateProjectLotDto} from './project-lots.dto';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import {Roles} from '../auth/decorators/roles.decorator';
import type {AuthUser} from '../auth/auth.types';
@Controller('project-lots') export class ProjectLotsController{constructor(private service:ProjectLotsService){} @Roles('ADMIN','EDITOR') @Post() create(@Body() dto:CreateProjectLotDto,@CurrentUser()user:AuthUser){return this.service.create(dto,user.organizationId,user.sub)} @Roles('ADMIN','EDITOR') @Delete(':id') remove(@Param('id') id:string,@CurrentUser()user:AuthUser){return this.service.remove(id,user.organizationId,user.sub)}}
