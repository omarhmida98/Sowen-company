import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { LotsService } from './lots.service';
import {Roles} from '../auth/decorators/roles.decorator';
class CreateLotDto { @IsString() name!: string; @IsOptional() @IsString() code?: string; }
@Controller('lots')
export class LotsController {
  constructor(private service: LotsService) {}
  @Get() list() { return this.service.list(); }
  @Roles('ADMIN') @Post() create(@Body() dto: CreateLotDto) { return this.service.create(dto.name, dto.code); }
}
