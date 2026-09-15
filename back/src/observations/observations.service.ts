import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ObservationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AssignObservationDto, CreateObservationDto, TransitionObservationDto, UpdateObservationDto } from './observations.dto';

const ALLOWED_TRANSITIONS: Record<ObservationStatus, ObservationStatus[]> = {
  OPEN: ['TO_SEND', 'BLOCKED', 'RESOLVED'],
  TO_SEND: ['SENT', 'BLOCKED', 'RESOLVED', 'OPEN'],
  SENT: ['WAITING', 'TO_RELAUNCH', 'BLOCKED', 'RESOLVED'],
  WAITING: ['TO_RELAUNCH', 'BLOCKED', 'RESOLVED', 'SENT'],
  TO_RELAUNCH: ['SENT', 'WAITING', 'BLOCKED', 'RESOLVED'],
  RESOLVED: ['OPEN'],
  BLOCKED: ['OPEN', 'TO_SEND', 'RESOLVED'],
};

@Injectable()
export class ObservationsService {
  constructor(private prisma: PrismaService) {}

  list(organizationId: string, projectId?: string) {
    return this.prisma.observation.findMany({
      where: { ...(projectId ? { projectId } : {}), project: { organizationId } },
      include: {
        lot: true,
        company: true,
        report: true,
        assignments: { include: { user: { select: { id: true, displayName: true, email: true } } } },
        evidence: { select: { id: true, reviewStatus: true, submittedByCompany: true } },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async get(id: string, organizationId: string) {
    const row = await this.prisma.observation.findFirst({
      where: { id, project: { organizationId } },
      include: {
        lot: true,
        company: true,
        report: true,
        history: { orderBy: { createdAt: 'desc' } },
        assignments: { include: { user: { select: { id: true, displayName: true, email: true, role: true } } } },
        generatedEmails: true,
        evidence: { include: { document: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!row) throw new NotFoundException('Observation not found');
    return row;
  }

  private async assertCompanyOwned(companyId: string | undefined, organizationId: string) {
    if (!companyId) return;
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company || company.organizationId !== organizationId) throw new ForbiddenException('Company does not belong to your organization');
  }

  private async assertLotExists(lotId: string | undefined) {
    if (!lotId) return;
    const lot = await this.prisma.lot.findUnique({ where: { id: lotId } });
    if (!lot) throw new NotFoundException('Lot not found');
  }


  private async ensureDraft(observationId: string) {
    const observation = await this.prisma.observation.findUnique({
      where: { id: observationId },
      include: { project: true, company: true, lot: true, generatedEmails: true },
    });
    if (!observation) throw new NotFoundException('Observation not found');
    const existing = observation.generatedEmails.find(e => ['DRAFT','NEEDS_RECIPIENT','SENT','DELIVERED','OPENED'].includes(e.status));
    if (existing) return existing;

    let recipient = observation.company?.email || null;
    if (!recipient && observation.lotId) {
      const projectLot = await this.prisma.projectLot.findUnique({
        where: { projectId_lotId: { projectId: observation.projectId, lotId: observation.lotId } },
        include: { company: true },
      });
      recipient = projectLot?.contactEmail || projectLot?.company?.email || null;
    }
    const body = `Bonjour,\n\nProjet : ${observation.project.name}\nLot : ${observation.lot?.name ?? 'À préciser'}\n${observation.dueDate ? `Échéance : ${observation.dueDate.toLocaleDateString('fr-FR')}\n` : ''}\nObservation : ${observation.description}\n${observation.reference ? `Référence : ${observation.reference}\n` : ''}${observation.requiredAction ? `Action attendue : ${observation.requiredAction}\n` : ''}\nMerci de nous transmettre votre retour et les justificatifs nécessaires.\n\nCordialement,\nSOWEN`;
    return this.prisma.generatedEmail.create({
      data: {
        projectId: observation.projectId,
        observationId: observation.id,
        recipientEmail: recipient,
        subject: `[SOWEN] ${observation.title}`,
        body,
        dueDate: observation.dueDate,
        status: recipient ? 'DRAFT' : 'NEEDS_RECIPIENT',
      },
    });
  }

  async create(dto: CreateObservationDto, organizationId: string, userId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.organizationId !== organizationId) throw new ForbiddenException('Project does not belong to your organization');
    await this.assertCompanyOwned(dto.companyId, organizationId);
    await this.assertLotExists(dto.lotId);

    const observation = await this.prisma.observation.create({
      data: { ...dto, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined },
      include: { company: true, lot: true, project: true },
    });
    await this.prisma.observationHistory.create({ data: { observationId: observation.id, toStatus: observation.status, note: 'Observation créée' } });

    await this.ensureDraft(observation.id);
    await this.prisma.activityLog.create({ data: { projectId: observation.projectId, userId, action: 'Observation créée', entityType: 'Observation', entityId: observation.id } });
    return observation;
  }

  async update(id: string, dto: UpdateObservationDto, organizationId: string, userId: string) {
    const current = await this.prisma.observation.findUnique({ where: { id }, include: { project: true } });
    if (!current) throw new NotFoundException('Observation not found');
    if (current.project.organizationId !== organizationId) throw new ForbiddenException('Observation does not belong to your organization');
    await this.assertCompanyOwned(dto.companyId, organizationId);
    await this.assertLotExists(dto.lotId);

    const { status, ...safeData } = dto;
    const updated = await this.prisma.observation.update({
      where: { id },
      data: { ...safeData, dueDate: dto.dueDate ? new Date(dto.dueDate) : dto.dueDate === undefined ? undefined : null },
    });
    if (status && status !== current.status) await this.transition(id, { status }, organizationId, userId);
    if (dto.companyId !== undefined || dto.lotId !== undefined || dto.dueDate !== undefined || dto.requiredAction !== undefined) {
      const existingDraft = await this.prisma.generatedEmail.findFirst({ where: { observationId: id, status: { in: ['DRAFT','NEEDS_RECIPIENT'] } } });
      if (existingDraft) {
        await this.prisma.generatedEmail.delete({ where: { id: existingDraft.id } });
        await this.ensureDraft(id);
      }
    }
    await this.prisma.activityLog.create({ data: { projectId: current.projectId, userId, action: 'Observation modifiée', entityType: 'Observation', entityId: id } });
    return this.get(id, organizationId);
  }

  async transition(id: string, dto: TransitionObservationDto, organizationId: string, userId: string) {
    const current = await this.prisma.observation.findUnique({ where: { id }, include: { project: true } });
    if (!current) throw new NotFoundException('Observation not found');
    if (current.project.organizationId !== organizationId) throw new ForbiddenException('Observation does not belong to your organization');
    if (dto.status === current.status) return current;
    if (!ALLOWED_TRANSITIONS[current.status].includes(dto.status)) {
      throw new BadRequestException(`Transition ${current.status} → ${dto.status} non autorisée`);
    }

    if (dto.status === 'TO_SEND') await this.ensureDraft(id);
    const updated = await this.prisma.observation.update({ where: { id }, data: { status: dto.status } });
    await this.prisma.observationHistory.create({
      data: { observationId: id, fromStatus: current.status, toStatus: dto.status, note: dto.note || null },
    });
    await this.prisma.activityLog.create({
      data: {
        projectId: current.projectId,
        userId,
        action: dto.status === 'RESOLVED' ? 'Observation clôturée' : dto.status === 'OPEN' && current.status === 'RESOLVED' ? 'Observation rouverte' : `Observation passée à ${dto.status}`,
        entityType: 'Observation',
        entityId: id,
        metadata: dto.note ? { note: dto.note } : undefined,
      },
    });
    return updated;
  }

  async assign(id: string, dto: AssignObservationDto, organizationId: string, userId: string) {
    const observation = await this.prisma.observation.findFirst({ where: { id, project: { organizationId } } });
    if (!observation) throw new NotFoundException('Observation not found');
    const assignee = await this.prisma.user.findFirst({ where: { id: dto.userId, organizationId } });
    if (!assignee) throw new ForbiddenException('User does not belong to your organization');
    const assignment = await this.prisma.observationAssignment.upsert({
      where: { observationId_userId: { observationId: id, userId: dto.userId } },
      update: {},
      create: { observationId: id, userId: dto.userId },
      include: { user: { select: { id: true, displayName: true, email: true, role: true } } },
    });
    await this.prisma.activityLog.create({ data: { projectId: observation.projectId, userId, action: `Observation assignée à ${assignee.displayName || assignee.email}`, entityType: 'Observation', entityId: id } });
    return assignment;
  }

  async unassign(id: string, assigneeId: string, organizationId: string, userId: string) {
    const observation = await this.prisma.observation.findFirst({ where: { id, project: { organizationId } } });
    if (!observation) throw new NotFoundException('Observation not found');
    await this.prisma.observationAssignment.deleteMany({ where: { observationId: id, userId: assigneeId } });
    await this.prisma.activityLog.create({ data: { projectId: observation.projectId, userId, action: 'Responsable retiré de l’observation', entityType: 'Observation', entityId: id } });
    return { ok: true };
  }
}
