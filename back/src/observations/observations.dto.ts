import { ObservationStatus, Severity } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateObservationDto {
  @IsString() projectId!: string;
  @IsOptional() @IsString() reportId?: string;
  @IsOptional() @IsString() lotId?: string;
  @IsOptional() @IsString() companyId?: string;
  @IsString() title!: string;
  @IsString() description!: string;
  @IsOptional() @IsString() originalText?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() requiredAction?: string;
  @IsOptional() @IsEnum(Severity) severity?: Severity;
  @IsOptional() @IsDateString() dueDate?: string;
}

export class UpdateObservationDto {
  @IsOptional() @IsEnum(ObservationStatus) status?: ObservationStatus;
  @IsOptional() @IsEnum(Severity) severity?: Severity;
  @IsOptional() @IsString() requiredAction?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() lotId?: string;
}

export class TransitionObservationDto {
  @IsEnum(ObservationStatus) status!: ObservationStatus;
  @IsOptional() @IsString() note?: string;
}

export class AssignObservationDto {
  @IsString() userId!: string;
}
