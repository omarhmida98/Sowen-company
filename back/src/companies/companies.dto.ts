import { IsEmail, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';
export class CreateCompanyDto {
  @IsOptional() @IsString() organizationId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsString() name!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() contactName?: string;
}
export class UpdateCompanyDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== '' && v !== null) @IsEmail() email?: string | null;
  @IsOptional() @IsString() phone?: string | null;
  @IsOptional() @IsString() contactName?: string | null;
}
