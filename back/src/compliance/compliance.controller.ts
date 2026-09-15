import { Body, Controller, Post } from '@nestjs/common';
import { ArrayNotEmpty, IsArray, IsOptional, IsString } from 'class-validator';
import { ComplianceService } from './compliance.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/auth.types';

class PrecheckDto {
  @IsString() projectId!: string;
  @IsString() rawText!: string;
  @IsOptional() @IsString() lotId?: string;
}

class MaterializePrecheckDto {
  @IsString() workDescriptionId!: string;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) ruleIds!: string[];
}

@Controller('compliance')
export class ComplianceController {
  constructor(private service: ComplianceService) {}

  @Roles('ADMIN', 'EDITOR')
  @Post('precheck')
  precheck(@Body() dto: PrecheckDto, @CurrentUser() user: AuthUser) {
    return this.service.precheck(dto.projectId, dto.rawText, dto.lotId, user.organizationId, user.sub);
  }

  @Roles('ADMIN', 'EDITOR')
  @Post('materialize')
  materialize(@Body() dto: MaterializePrecheckDto, @CurrentUser() user: AuthUser) {
    return this.service.materialize(dto.workDescriptionId, dto.ruleIds, user.organizationId, user.sub);
  }
}
