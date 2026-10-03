import { ObservationStatus, Severity } from '@prisma/client';
import { IsDateString, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

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

// Every field is optional: only the fields that are sent are changed. null clears lot, company, due date,
// reference and required action.
export class UpdateObservationDto {
  @IsOptional() @IsEnum(ObservationStatus) status?: ObservationStatus;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(10000) description?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) reference?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(5000) requiredAction?: string | null;
  @IsOptional() @IsEnum(Severity) severity?: Severity;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() dueDate?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() companyId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() lotId?: string | null;
}

export class ReviewObservationDto {
  @IsIn(['VALIDATED', 'REJECTED', 'PENDING']) decision!: 'VALIDATED' | 'REJECTED' | 'PENDING';
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class TransitionObservationDto {
  @IsEnum(ObservationStatus) status!: ObservationStatus;
  @IsOptional() @IsString() note?: string;
}

export class AssignObservationDto {
  @IsString() userId!: string;
}
