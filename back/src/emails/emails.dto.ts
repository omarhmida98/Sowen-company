import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ObservationEmailDto {
  @IsString() companyId!: string;
  @IsString() @MinLength(1) @MaxLength(300) subject!: string;
  @IsString() @MinLength(1) @MaxLength(20000) body!: string;
}

export class SendObservationEmailDto extends ObservationEmailDto {
  @IsOptional() @IsBoolean() allowResend?: boolean;
}
