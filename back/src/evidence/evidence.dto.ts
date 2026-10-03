import { EvidenceReviewStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewEvidenceDto {
  @IsEnum(EvidenceReviewStatus) status!: EvidenceReviewStatus;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
