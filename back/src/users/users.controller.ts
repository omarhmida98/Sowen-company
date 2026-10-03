import {Body,Controller,Delete,Get,HttpCode,Param,Patch,Post} from '@nestjs/common';
import {UsersService} from './users.service';
import {InviteUserDto,UpdateUserRoleDto} from './users.dto';
import {CurrentUser} from '../auth/decorators/current-user.decorator';
import {Roles} from '../auth/decorators/roles.decorator';
import type {AuthUser} from '../auth/auth.types';
@Controller('users')
@Roles('ADMIN')
export class UsersController{
  constructor(private s:UsersService){}
  @Get() list(@CurrentUser()user:AuthUser){return this.s.list(user.organizationId)}
  @Roles('ADMIN','EDITOR') @Get('assignable') assignable(@CurrentUser()user:AuthUser){return this.s.assignable(user.organizationId)}
  @Post() invite(@Body()dto:InviteUserDto,@CurrentUser()user:AuthUser){return this.s.invite(dto,user.organizationId,user.sub)}
  @Post(':id/invitation') @HttpCode(200) resend(@Param('id')id:string,@CurrentUser()user:AuthUser){return this.s.resendInvitation(id,user.organizationId,user.sub)}
  @Post(':id/reset-password') @HttpCode(200) reset(@Param('id')id:string,@CurrentUser()user:AuthUser){return this.s.resetPassword(id,user.organizationId,user.sub)}
  @Patch(':id/role') role(@Param('id')id:string,@Body()dto:UpdateUserRoleDto,@CurrentUser()user:AuthUser){return this.s.updateRole(id,dto.role,user.organizationId,user.sub)}
  @Delete(':id') remove(@Param('id')id:string,@CurrentUser()user:AuthUser){return this.s.remove(id,user.organizationId,user.sub)}
}
