import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ObservationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddResponseDto, AssignObservationDto, CloseObservationDto, CreateObservationDto, ReviewObservationDto, TransitionObservationDto, UpdateObservationDto } from './observations.dto';
import { EDITABLE_FIELDS, describeChanges, diffObservation } from './observation-rules';

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
        responses: { orderBy: { createdAt: 'desc' } },
        assignments: { include: { user: { select: { id: true, displayName: true, email: true, role: true } } } },
        generatedEmails: { orderBy: { createdAt: 'desc' } },
        evidence: { include: { document: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!row) throw new NotFoundException('Observation not found');
    // Names of the people referred to by id: who recorded a response, who closed the observation.
    const ids = [...new Set([row.closedById, ...row.responses.map(r => r.userId)].filter((v): v is string => !!v))];
    const names: Record<string, string> = {};
    for (const u of ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, email: true } }) : []) names[u.id] = u.displayName || u.email;
    return { ...row, closedBy: row.closedById ? names[row.closedById] || null : null, responses: row.responses.map(r => ({ ...r, author: r.userId ? names[r.userId] || null : null })) };
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

  // Edits an observation. Only the fields that really change are written, each change is recorded in the
  // observation history and in the activity log, and the first edit marks the observation as edited by a person.
  async update(id: string, dto: UpdateObservationDto, organizationId: string, userId: string) {
    const current = await this.prisma.observation.findFirst({ where: { id, project: { organizationId } } });
    if (!current) throw new NotFoundException('Observation not found');
    if (dto.companyId) await this.assertCompanyOwned(dto.companyId, organizationId);
    if (dto.lotId) await this.assertLotExists(dto.lotId);

    const { status, ...fields } = dto;
    const next: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) {
      if (fields[field] === undefined) continue;
      if (field === 'dueDate') next.dueDate = fields.dueDate ? new Date(fields.dueDate) : null;
      else if (field === 'title' || field === 'description') next[field] = String(fields[field]).trim();
      else if (field === 'severity') next.severity = fields.severity;
      else next[field] = typeof fields[field] === 'string' ? (fields[field] as string).trim() || null : null;
    }
    if (next.title === '' || next.description === '') throw new BadRequestException('Le titre et la description ne peuvent pas être vides.');

    const ids = [current.lotId, current.companyId, next.lotId, next.companyId].filter((v): v is string => typeof v === 'string');
    const names: Record<string, string> = {};
    if (ids.length) {
      for (const lot of await this.prisma.lot.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) names[lot.id] = lot.name;
      for (const company of await this.prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) names[company.id] = company.name;
    }
    const changes = diffObservation(current, next as any, names);

    if (changes.length) {
      const data: Record<string, unknown> = {};
      for (const change of changes) data[change.field] = next[change.field];
      await this.prisma.observation.update({ where: { id }, data: { ...data, editedAt: new Date() } });
      await this.prisma.observationHistory.create({ data: { observationId: id, fromStatus: current.status, toStatus: current.status, note: describeChanges(changes) } });
      await this.prisma.activityLog.create({ data: { projectId: current.projectId, userId, action: 'Observation modifiée', entityType: 'Observation', entityId: id, metadata: { changes: changes.map(c => ({ field: c.field, from: c.from, to: c.to })) } } });
      // An automatic draft that nobody saved or sent is rebuilt from the new content; a draft a person saved is kept.
      const draft = await this.prisma.generatedEmail.findFirst({ where: { observationId: id, sentAt: null, status: { in: ['DRAFT', 'NEEDS_RECIPIENT'] } } });
      if (draft && !(await this.prisma.activityLog.findFirst({ where: { entityType: 'GeneratedEmail', entityId: draft.id, action: { startsWith: 'Brouillon de mail enregistré' } }, select: { id: true } }))) {
        await this.prisma.generatedEmail.delete({ where: { id: draft.id } });
        await this.ensureDraft(id);
      }
    }
    if (status && status !== current.status) await this.transition(id, { status }, organizationId, userId);
    return this.get(id, organizationId);
  }

  // Human decision on an observation extracted by the AI from a report.
  async review(id: string, dto: ReviewObservationDto, organizationId: string, userId: string) {
    const current = await this.prisma.observation.findFirst({ where: { id, project: { organizationId } }, include: { generatedEmails: { select: { id: true, sentAt: true, status: true } } } });
    if (!current) throw new NotFoundException('Observation not found');
    if (!current.reviewStatus) throw new BadRequestException('Cette observation a été créée manuellement : elle n’a pas de revue IA.');
    if (dto.decision === current.reviewStatus) return this.get(id, organizationId);
    const note = dto.note?.trim();
    const sent = current.generatedEmails.some(e => e.sentAt && e.status !== 'ERROR');

    if (dto.decision === 'REJECTED') {
      // Something already sent to a company cannot be un-sent: it has to be handled through the normal workflow.
      if (sent) throw new BadRequestException('Cette observation a déjà été envoyée à une entreprise : elle ne peut plus être rejetée. Clôturez-la si elle n’est plus d’actualité.');
      // A rejected observation leaves every active list (it is closed) and its unsent drafts are removed.
      await this.prisma.generatedEmail.deleteMany({ where: { observationId: id, sentAt: null } });
      await this.prisma.observation.update({ where: { id }, data: { reviewStatus: 'REJECTED', reviewedAt: new Date(), reviewedById: userId, status: 'RESOLVED' } });
      await this.prisma.observationHistory.create({ data: { observationId: id, fromStatus: current.status, toStatus: 'RESOLVED', note: `Observation IA rejetée${note ? ` : ${note}` : ''}` } });
    } else if (dto.decision === 'VALIDATED') {
      const reopen = current.reviewStatus === 'REJECTED';
      await this.prisma.observation.update({ where: { id }, data: { reviewStatus: 'VALIDATED', reviewedAt: new Date(), reviewedById: userId, ...(reopen ? { status: 'OPEN' } : {}) } });
      await this.prisma.observationHistory.create({ data: { observationId: id, fromStatus: current.status, toStatus: reopen ? 'OPEN' : current.status, note: `Observation IA validée${note ? ` : ${note}` : ''}` } });
      if (reopen) await this.ensureDraft(id);
    } else {
      const reopen = current.reviewStatus === 'REJECTED';
      await this.prisma.observation.update({ where: { id }, data: { reviewStatus: 'PENDING', reviewedAt: null, reviewedById: null, ...(reopen ? { status: 'OPEN' } : {}) } });
      await this.prisma.observationHistory.create({ data: { observationId: id, fromStatus: current.status, toStatus: reopen ? 'OPEN' : current.status, note: 'Revue IA remise à valider' } });
      if (reopen) await this.ensureDraft(id);
    }
    await this.prisma.activityLog.create({ data: { projectId: current.projectId, userId, action: dto.decision === 'REJECTED' ? 'Observation IA rejetée' : dto.decision === 'VALIDATED' ? 'Observation IA validée' : 'Observation IA remise à valider', entityType: 'Observation', entityId: id, metadata: note ? { note } : undefined } });
    return this.get(id, organizationId);
  }

  // A response of the company recorded by the team (received by phone, email, on site…). Like a portal response it
  // is kept as is and puts the observation in "En attente".
  async addResponse(id: string, dto: AddResponseDto, organizationId: string, userId: string) {
    const current = await this.prisma.observation.findFirst({ where: { id, project: { organizationId } } });
    if (!current) throw new NotFoundException('Observation not found');
    if (current.status === 'RESOLVED') throw new BadRequestException('Cette observation est clôturée. Rouvrez-la pour enregistrer une réponse.');
    const message = dto.message.trim();
    if (!message) throw new BadRequestException('Le message est obligatoire.');
    await this.prisma.observationResponse.create({ data: { observationId: id, source: 'INTERNAL', message, companyId: current.companyId, userId } });
    const next = ['SENT', 'TO_RELAUNCH'].includes(current.status) ? 'WAITING' : current.status;
    if (next !== current.status) await this.prisma.observation.update({ where: { id }, data: { status: 'WAITING' } });
    await this.prisma.observationHistory.create({ data: { observationId: id, fromStatus: current.status, toStatus: next, note: 'Réponse de l’entreprise saisie par l’équipe' } });
    await this.prisma.activityLog.create({ data: { projectId: current.projectId, userId, action: 'Réponse entreprise saisie par l’équipe', entityType: 'Observation', entityId: id } });
    return this.get(id, organizationId);
  }

  // Closing is an explicit decision of an administrator or editor. It needs at least one approved proof, or a
  // confirmation that no proof is required. Proofs still waiting for review must be reviewed first. Responses,
  // proofs and history stay attached to the closed observation.
  async close(id: string, dto: CloseObservationDto, organizationId: string, userId: string) {
    const current = await this.prisma.observation.findFirst({ where: { id, project: { organizationId } }, include: { evidence: { select: { reviewStatus: true } } } });
    if (!current) throw new NotFoundException('Observation not found');
    if (current.reviewStatus === 'REJECTED') throw new BadRequestException('Cette observation IA a été rejetée : elle n’a pas à être clôturée.');
    if (current.status === 'RESOLVED') throw new BadRequestException('Cette observation est déjà clôturée.');
    const approved = current.evidence.filter(e => e.reviewStatus === 'APPROVED').length;
    const pending = current.evidence.filter(e => e.reviewStatus === 'PENDING').length;
    if (pending) throw new BadRequestException(`${pending} justificatif(s) attendent encore votre décision. Validez-les ou refusez-les avant de clôturer.`);
    if (!approved && dto.confirmWithoutProof !== true) throw new BadRequestException('Aucun justificatif n’a été validé. Confirmez la clôture sans justificatif pour continuer.');
    const note = dto.note?.trim() || null;
    const now = new Date();
    await this.prisma.observation.update({ where: { id }, data: { status: 'RESOLVED', closedAt: now, closedById: userId, closureNote: note } });
    await this.prisma.observationHistory.create({ data: { observationId: id, fromStatus: current.status, toStatus: 'RESOLVED', note: `${approved ? `Observation clôturée (${approved} justificatif(s) validé(s))` : 'Observation clôturée sans justificatif'}${note ? ` — ${note}` : ''}` } });
    await this.prisma.activityLog.create({ data: { projectId: current.projectId, userId, action: 'Observation clôturée', entityType: 'Observation', entityId: id, metadata: { approvedEvidence: approved, withoutProof: !approved, note } } });
    return this.get(id, organizationId);
  }

  async transition(id: string, dto: TransitionObservationDto, organizationId: string, userId: string) {
    const current = await this.prisma.observation.findUnique({ where: { id }, include: { project: true } });
    if (!current) throw new NotFoundException('Observation not found');
    if (current.project.organizationId !== organizationId) throw new ForbiddenException('Observation does not belong to your organization');
    if (dto.status === current.status) return current;
    if (current.reviewStatus === 'REJECTED') throw new BadRequestException('Cette observation IA a été rejetée. Rétablissez-la avant de modifier son statut.');
    // Closing has its own rule (see close()); a plain status change cannot bypass it.
    if (dto.status === 'RESOLVED') throw new BadRequestException('Utilisez l’action « Clôturer l’observation » : la clôture demande un justificatif validé ou une confirmation.');
    if (!ALLOWED_TRANSITIONS[current.status].includes(dto.status)) {
      throw new BadRequestException(`Transition ${current.status} → ${dto.status} non autorisée`);
    }

    if (dto.status === 'TO_SEND') await this.ensureDraft(id);
    // Reopening forgets the closure; the history keeps the trace of it.
    const updated = await this.prisma.observation.update({ where: { id }, data: { status: dto.status, ...(current.status === 'RESOLVED' ? { closedAt: null, closedById: null, closureNote: null } : {}) } });
    await this.prisma.observationHistory.create({
      data: { observationId: id, fromStatus: current.status, toStatus: dto.status, note: dto.note || null },
    });
    await this.prisma.activityLog.create({
      data: {
        projectId: current.projectId,
        userId,
        action: dto.status === 'OPEN' && current.status === 'RESOLVED' ? 'Observation rouverte' : `Observation passée à ${dto.status}`,
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
