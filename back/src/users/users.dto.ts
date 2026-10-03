import {IsEmail,IsEnum,IsString,MaxLength,MinLength} from 'class-validator';
import {UserRole} from '@prisma/client';
// No password here: the invited person chooses it through the invitation link.
export class InviteUserDto{
  @IsEmail() email!:string;
  @IsString() @MinLength(1) @MaxLength(120) displayName!:string;
  @IsEnum(UserRole) role!:UserRole;
}
export class UpdateUserRoleDto{ @IsEnum(UserRole) role!:UserRole; }
