import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import path from 'path';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}
  list(organizationId: string, projectId?: string) { return this.prisma.document.findMany({ where: { ...(projectId ? { projectId } : {}), project: { organizationId } }, orderBy: { uploadedAt: 'desc' } }); }
  async upload(projectId: string, type: any, file: Express.Multer.File, organizationId: string, userId: string) {
    await this.assertProject(projectId, organizationId);
    const dir = path.resolve(process.cwd(), 'uploads', projectId);
    await fs.mkdir(dir, { recursive: true });
    const safe = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const full = path.join(dir, safe);
    await fs.writeFile(full, file.buffer);
    const doc = await this.prisma.document.create({ data: { projectId, type, name: file.originalname, storageKey: full, mimeType: file.mimetype, sizeBytes: file.size } });
    await this.prisma.activityLog.create({ data: { projectId, userId, action: 'Document ajouté', entityType: 'Document', entityId: doc.id } });
    return doc;
  }
  private async assertProject(projectId: string, organizationId: string) { const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { organizationId: true } }); if (!p) throw new NotFoundException('Project not found'); if (p.organizationId !== organizationId) throw new ForbiddenException('Project does not belong to your organization'); }
}
