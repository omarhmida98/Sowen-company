import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
// The password rules themselves are in password-policy.ts; the lengths here only bound the input.
export class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) @MaxLength(200) password!: string;
  @IsString() organizationName!: string;
  @IsString() displayName!: string;
}
export class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MaxLength(200) password!: string;
}
export class RefreshDto {
  @IsString() @MaxLength(2000) refreshToken!: string;
}
export class ChangePasswordDto {
  @IsString() @MaxLength(200) currentPassword!: string;
  @IsString() @MaxLength(200) newPassword!: string;
  @IsString() @MaxLength(200) confirmPassword!: string;
}
export class InvitationLookupDto {
  @IsString() @MaxLength(200) token!: string;
}
export class AcceptInvitationDto {
  @IsString() @MaxLength(200) token!: string;
  @IsString() @MaxLength(200) password!: string;
  @IsString() @MaxLength(200) confirmPassword!: string;
}
