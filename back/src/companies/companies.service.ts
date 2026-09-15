import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto } from './companies.dto';
@Injectable()
export class CompaniesService {
  constructor(private prisma: PrismaService) {}
  list(organizationId: string) {
    return this.prisma.company.findMany({ where: { organizationId }, orderBy: { name: 'asc' }, include: { _count: { select: { projectLots: true, observations: true } } } });
  }
  async create(dto: CreateCompanyDto, organizationId: string, userId: string) {
    if (dto.projectId) {
      const project = await this.prisma.project.findUnique({ where: { id: dto.projectId }, select: { organizationId: true } });
      if (!project) throw new NotFoundException('Project not found');
      if (project.organizationId !== organizationId) throw new ForbiddenException('Project does not belong to your organization');
    }
    const company = await this.prisma.company.create({ data: { organizationId, name: dto.name, email: dto.email || null, phone: dto.phone || null, contactName: dto.contactName || null } });
    await this.prisma.activityLog.create({ data: { projectId: dto.projectId || null, userId, action: 'Entreprise ajoutée', entityType: 'Company', entityId: company.id } });
    return company;
  }
  async remove(id: string, organizationId: string) { const c = await this.prisma.company.findUnique({ where: { id }, select: { organizationId: true } }); if (!c) throw new NotFoundException('Company not found'); if (c.organizationId !== organizationId) throw new ForbiddenException('Company does not belong to your organization'); return this.prisma.company.delete({ where: { id } }); }
}
