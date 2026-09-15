import {Body,Controller,Delete,Get,Param,Patch,Post} from '@nestjs/common';
import {UsersService} from './users.service';
import {CreateUserDto,UpdateUserRoleDto} from './users.dto';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import {Roles} from '../auth/decorators/roles.decorator';
import type {AuthUser} from '../auth/auth.types';
@Controller('users')
@Roles('ADMIN')
export class UsersController{
  constructor(private s:UsersService){}
  @Get() list(@CurrentUser()user:AuthUser){return this.s.list(user.organizationId)}
  @Roles('ADMIN','EDITOR') @Get('assignable') assignable(@CurrentUser()user:AuthUser){return this.s.list(user.organizationId)}
  @Post() create(@Body()dto:CreateUserDto,@CurrentUser()user:AuthUser){return this.s.create(dto,user.organizationId,user.sub)}
  @Patch(':id/role') role(@Param('id')id:string,@Body()dto:UpdateUserRoleDto,@CurrentUser()user:AuthUser){return this.s.updateRole(id,dto.role,user.organizationId,user.sub)}
  @Delete(':id') remove(@Param('id')id:string,@CurrentUser()user:AuthUser){return this.s.remove(id,user.organizationId,user.sub)}
}
