import { BuildingType, ProjectStatus } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
export class CreateProjectDto {
  @IsOptional() @IsString() organizationId?: string;
  @IsString() name!: string;
  @IsOptional() @IsString() address?: string;
  @IsEnum(BuildingType) buildingType!: BuildingType;
  @IsOptional() @IsString() erpType?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsBoolean() includeOwner?: boolean;
}
export class UpdateProjectDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsEnum(ProjectStatus) status?: ProjectStatus;
}
