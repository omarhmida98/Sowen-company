import { Injectable } from '@nestjs/common';
import { BuildingType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRuleDto } from './rules.dto';
@Injectable()
export class RulesService {
  constructor(private prisma: PrismaService) {}
  list(filters: { domain?: string; buildingType?: BuildingType; erpType?: string; lotId?: string }) {
    return this.prisma.rule.findMany({ where: { active: true, ...(filters.domain && { domain: filters.domain }), ...(filters.buildingType && { buildingType: filters.buildingType }), ...(filters.erpType && { OR: [{ erpType: filters.erpType }, { erpType: null }] }), ...(filters.lotId && { lotId: filters.lotId }) }, include: { lot: true, source: true, _count: { select: { versions: true } } }, orderBy: [{ domain: 'asc' }, { title: 'asc' }] });
  }
  get(id: string) { return this.prisma.rule.findUnique({ where: { id }, include: { lot: true, source: true, versions: { orderBy: { version: 'desc' } } } }); }
  async create(dto: CreateRuleDto, userId: string) { const rule = await this.prisma.rule.create({ data: { ...dto, lotId: dto.lotId || null, sourceId: dto.sourceId || null } }); await this.prisma.ruleVersion.create({data:{ruleId:rule.id,version:1,requirement:rule.requirement,actionRequest:rule.actionRequest}}); await this.prisma.activityLog.create({ data: { userId, action: 'Règle ajoutée', entityType: 'Rule', entityId: rule.id } }); return rule; }
  async addVersion(id:string, body:{requirement:string;actionRequest?:string;effectiveFrom?:string}, userId:string) { const last=await this.prisma.ruleVersion.findFirst({where:{ruleId:id},orderBy:{version:'desc'}}); const version=(last?.version||0)+1; const row=await this.prisma.ruleVersion.create({data:{ruleId:id,version,requirement:body.requirement,actionRequest:body.actionRequest||null,effectiveFrom:body.effectiveFrom?new Date(body.effectiveFrom):null}}); await this.prisma.rule.update({where:{id},data:{requirement:body.requirement,actionRequest:body.actionRequest||null}}); await this.prisma.activityLog.create({data:{userId,action:`Nouvelle version de règle v${version}`,entityType:'Rule',entityId:id}}); return row; }
  async archive(id: string, userId: string) { const row=await this.prisma.rule.update({ where: { id }, data: { active: false } }); await this.prisma.activityLog.create({data:{userId,action:'Règle archivée',entityType:'Rule',entityId:id}}); return row; }
}
