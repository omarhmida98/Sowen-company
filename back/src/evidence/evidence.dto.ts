import { EvidenceReviewStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ReviewEvidenceDto {
  @IsEnum(EvidenceReviewStatus) status!: EvidenceReviewStatus;
  @IsOptional() @IsString() note?: string;
}
