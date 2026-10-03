import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateProjectDto, UpdateProjectDto } from './projects.dto';
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  constructor(private prisma: PrismaService, private storage: StorageService) {}
  list(organizationId: string) { return this.prisma.project.findMany({ where: { organizationId }, orderBy: { updatedAt: 'desc' }, include: { lots: { include: { lot: true, company: true } }, _count: { select: { observations: true, documents: true } } } }); }
  async get(id: string, organizationId: string) { const p = await this.prisma.project.findFirst({ where: { id, organizationId }, include: { lots: { include: { lot: true, company: true } }, observations: { orderBy: { updatedAt: 'desc' }, include: { lot: true, company: true } }, reports: true, documents: true } }); if (!p) throw new NotFoundException('Project not found'); return p; }
  async create(dto: CreateProjectDto, organizationId: string, userId: string) { const { organizationId: _ignored, ...data } = dto; const p = await this.prisma.project.create({ data: { ...data, organizationId } }); await this.prisma.activityLog.create({ data: { projectId: p.id, userId, action: 'Projet créé', entityType: 'Project', entityId: p.id } }); return p; }
  async update(id: string, dto: UpdateProjectDto, organizationId: string, userId: string) { await this.assertOwned(id, organizationId); const p = await this.prisma.project.update({ where: { id }, data: dto }); await this.prisma.activityLog.create({ data: { projectId: id, userId, action: 'Projet modifié', entityType: 'Project', entityId: id } }); return p; }
  // The project and its records are deleted first (one database operation); its stored files are removed afterwards.
  // A file that cannot be removed is logged as orphaned: it is unused, and no record points to a missing file.
  async remove(id: string, organizationId: string) {
    await this.assertOwned(id, organizationId);
    const files = await this.prisma.document.findMany({ where: { projectId: id }, select: { storageKey: true } });
    const project = await this.prisma.project.delete({ where: { id } });
    let orphaned = 0;
    for (const file of files) if (!(await this.storage.remove(file.storageKey))) orphaned++;
    if (orphaned) this.logger.error(`Project ${id} deleted, but ${orphaned} of ${files.length} stored file(s) could not be removed`);
    return { ...project, filesRemoved: files.length - orphaned, filesOrphaned: orphaned };
  }
  private async assertOwned(id: string, organizationId: string) { const p = await this.prisma.project.findUnique({ where: { id }, select: { organizationId: true } }); if (!p) throw new NotFoundException('Project not found'); if (p.organizationId !== organizationId) throw new ForbiddenException('Project does not belong to your organization'); }
}
