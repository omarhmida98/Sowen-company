import { BadRequestException, ForbiddenException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export function fileResponse(buffer: Buffer, name: string | null | undefined, mimeType: string | null | undefined) {
  return new StreamableFile(buffer, {
    type: mimeType || 'application/octet-stream',
    disposition: `attachment; filename*=UTF-8''${encodeURIComponent(name || 'document')}`,
  });
}

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService, private storage: StorageService) {}
  list(organizationId: string, projectId?: string) { return this.prisma.document.findMany({ where: { ...(projectId ? { projectId } : {}), project: { organizationId } }, orderBy: { uploadedAt: 'desc' } }); }
  async upload(projectId: string, type: any, file: Express.Multer.File, organizationId: string, userId: string) {
    await this.assertProject(projectId, organizationId);
    const storageKey = await this.storage.save({ projectId, folder: 'documents', originalName: file.originalname, buffer: file.buffer, contentType: file.mimetype });
    try {
      const doc = await this.prisma.document.create({ data: { projectId, type, name: file.originalname, storageKey, mimeType: file.mimetype, sizeBytes: file.size } });
      await this.prisma.activityLog.create({ data: { projectId, userId, action: 'Document ajouté', entityType: 'Document', entityId: doc.id } });
      return doc;
    } catch (error) {
      // The record was not created: do not leave the file behind.
      await this.storage.remove(storageKey);
      throw error;
    }
  }

  // Only a document of the caller's organization can be found; anything else is "not found".
  private async owned(id: string, organizationId: string) {
    const doc = await this.prisma.document.findFirst({ where: { id, project: { organizationId } }, select: { id: true, projectId: true, name: true, type: true, mimeType: true, storageKey: true } });
    if (!doc) throw new NotFoundException('Document introuvable');
    return doc;
  }

  async download(id: string, organizationId: string) {
    const doc = await this.owned(id, organizationId);
    return fileResponse(await this.storage.read(doc.storageKey), doc.name, doc.mimeType);
  }

  // The record goes first, the file second: a failure in between leaves an unused file (reported), never a
  // document that points to nothing.
  async remove(id: string, organizationId: string, userId: string) {
    const doc = await this.owned(id, organizationId);
    if (doc.type === 'CONTROL_REPORT' && (await this.prisma.controlReport.count({ where: { documentId: id } }))) {
      throw new BadRequestException('Ce document est le fichier d’un rapport Bureau de Contrôle et ne peut pas être supprimé ici.');
    }
    await this.prisma.document.delete({ where: { id } });
    const fileRemoved = await this.storage.remove(doc.storageKey);
    await this.prisma.activityLog.create({ data: { projectId: doc.projectId, userId, action: fileRemoved ? 'Document supprimé' : 'Document supprimé (fichier non effacé du stockage)', entityType: 'Document', entityId: id, metadata: { name: doc.name, fileRemoved } } });
    return { deleted: true, fileRemoved };
  }

  private async assertProject(projectId: string, organizationId: string) { const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { organizationId: true } }); if (!p) throw new NotFoundException('Project not found'); if (p.organizationId !== organizationId) throw new ForbiddenException('Project does not belong to your organization'); }
}
