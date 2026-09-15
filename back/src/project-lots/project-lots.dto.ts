import { IsEmail, IsOptional, IsString } from 'class-validator';
export class CreateProjectLotDto { @IsString() projectId!: string; @IsString() lotId!: string; @IsOptional() @IsString() companyId?: string; @IsOptional() @IsEmail() contactEmail?: string; }
