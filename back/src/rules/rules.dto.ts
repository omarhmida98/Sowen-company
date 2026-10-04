import { BuildingType, Severity } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

// category = `domain`; description = `summary`; what to check before work = `controlPoint`;
// recommended preventive action = `actionRequest`.
export class RuleDto {
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsString() @MinLength(1) @MaxLength(80) domain!: string;
  @IsString() @MinLength(1) @MaxLength(4000) requirement!: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(2000) summary?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() lotId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) workType?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) reference?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) sourceDocument?: string | null;
  @IsOptional() @IsEnum(Severity) severity?: Severity;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(2000) controlPoint?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(2000) actionRequest?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) evidenceRequired?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsEnum(BuildingType) buildingType?: BuildingType | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(20) erpType?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateRuleDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) domain?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(4000) requirement?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(2000) summary?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() lotId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) workType?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) reference?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) sourceDocument?: string | null;
  @IsOptional() @IsEnum(Severity) severity?: Severity;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(2000) controlPoint?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(2000) actionRequest?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) evidenceRequired?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsEnum(BuildingType) buildingType?: BuildingType | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(20) erpType?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}
