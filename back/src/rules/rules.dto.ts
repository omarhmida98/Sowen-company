import { BuildingType, Severity } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
export class CreateRuleDto {
  @IsOptional() @IsString() lotId?: string;
  @IsOptional() @IsString() sourceId?: string;
  @IsString() domain!: string;
  @IsOptional() @IsString() framework?: string;
  @IsOptional() @IsEnum(BuildingType) buildingType?: BuildingType;
  @IsOptional() @IsString() erpType?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() workType?: string;
  @IsString() title!: string;
  @IsString() summary!: string;
  @IsOptional() @IsString() condition?: string;
  @IsString() requirement!: string;
  @IsOptional() @IsString() controlPoint?: string;
  @IsOptional() @IsString() evidenceRequired?: string;
  @IsOptional() @IsString() actionRequest?: string;
  @IsOptional() @IsEnum(Severity) severity?: Severity;
  @IsOptional() @IsBoolean() actionable?: boolean;
}
