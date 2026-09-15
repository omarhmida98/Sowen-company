import {IsEmail,IsEnum,IsString,MinLength} from 'class-validator';
import {UserRole} from '@prisma/client';
export class CreateUserDto{
  @IsEmail() email!:string;
  @IsString() displayName!:string;
  @IsString() @MinLength(8) password!:string;
  @IsEnum(UserRole) role!:UserRole;
}
export class UpdateUserRoleDto{ @IsEnum(UserRole) role!:UserRole; }
