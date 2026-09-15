import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto, UpdateProjectDto } from './projects.dto';
@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}
  list(organizationId: string) { return this.prisma.project.findMany({ where: { organizationId }, orderBy: { updatedAt: 'desc' }, include: { lots: { include: { lot: true, company: true } }, _count: { select: { observations: true, documents: true } } } }); }
  async get(id: string, organizationId: string) { const p = await this.prisma.project.findFirst({ where: { id, organizationId }, include: { lots: { include: { lot: true, company: true } }, observations: { orderBy: { updatedAt: 'desc' }, include: { lot: true, company: true } }, reports: true, documents: true } }); if (!p) throw new NotFoundException('Project not found'); return p; }
  async create(dto: CreateProjectDto, organizationId: string, userId: string) { const { organizationId: _ignored, ...data } = dto; const p = await this.prisma.project.create({ data: { ...data, organizationId } }); await this.prisma.activityLog.create({ data: { projectId: p.id, userId, action: 'Projet créé', entityType: 'Project', entityId: p.id } }); return p; }
  async update(id: string, dto: UpdateProjectDto, organizationId: string, userId: string) { await this.assertOwned(id, organizationId); const p = await this.prisma.project.update({ where: { id }, data: dto }); await this.prisma.activityLog.create({ data: { projectId: id, userId, action: 'Projet modifié', entityType: 'Project', entityId: id } }); return p; }
  async remove(id: string, organizationId: string) { await this.assertOwned(id, organizationId); return this.prisma.project.delete({ where: { id } }); }
  private async assertOwned(id: string, organizationId: string) { const p = await this.prisma.project.findUnique({ where: { id }, select: { organizationId: true } }); if (!p) throw new NotFoundException('Project not found'); if (p.organizationId !== organizationId) throw new ForbiddenException('Project does not belong to your organization'); }
}
