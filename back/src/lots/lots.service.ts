import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class LotsService {
  constructor(private prisma: PrismaService) {}
  list() { return this.prisma.lot.findMany({ orderBy: { name: 'asc' } }); }
  create(name: string, code?: string) { return this.prisma.lot.create({ data: { name, code: code || null } }); }
}
