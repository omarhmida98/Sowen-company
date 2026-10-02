import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EmailStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailSendError, MailerService } from '../mailer/mailer.service';
import { renderObservationEmail } from '../mailer/email-template';
import { companyPortalCta } from '../mailer/portal-link';
import { ObservationEmailDto, SendObservationEmailDto } from './emails.dto';

const UNSENT: EmailStatus[] = ['DRAFT', 'NEEDS_RECIPIENT', 'ERROR'];
const DRAFT_SAVED_ACTION = 'Brouillon de mail enregistré';
const SEVERITY_FR: Record<string, string> = { INFO: 'Information', LOW: 'Faible', MEDIUM: 'Moyenne', HIGH: 'Élevée', CRITICAL: 'Critique' };

@Injectable()
export class EmailsService {
  private readonly logger = new Logger(EmailsService.name);
  // Observations with a send in progress on this instance; the database claim in send() covers the email itself.
  private readonly sending = new Set<string>();

  constructor(private prisma: PrismaService, private mailer: MailerService) {}
  list(organizationId: string, projectId?: string) { return this.prisma.generatedEmail.findMany({ where: { ...(projectId ? { projectId } : {}), project: { organizationId } }, include: { observation: { include: { company: true, lot: true } } }, orderBy: { createdAt: 'desc' } }); }
  isConfigured() { return this.mailer.isConfigured(); }
  private assertConfigured() {
    if (!this.mailer.isConfigured()) throw new BadRequestException('L’envoi d’emails n’est pas configuré.');
  }
  // HTML + plain-text version of a stored email. The stored body stays the plain text the user edited.
  private async render(email: { projectId: string; observationId: string | null; body: string }, subject: string, reminder?: { level: number }) {
    const [project, observation] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: email.projectId }, select: { name: true, organization: { select: { name: true } } } }),
      email.observationId ? this.prisma.observation.findUnique({ where: { id: email.observationId }, select: { title: true, reference: true, companyId: true } }) : null,
    ]);
    return renderObservationEmail({
      subject,
      body: email.body,
      projectName: project?.name,
      observationTitle: observation?.title,
      reference: observation?.reference,
      organizationName: project?.organization.name,
      cta: await companyPortalCta(this.prisma, this.mailer, email.projectId, observation?.companyId),
      reminder,
    });
  }
  private async ownedEmail(id: string, organizationId: string) {
    const email = await this.prisma.generatedEmail.findUnique({ where: { id }, include: { project: { select: { organizationId: true } } } });
    if (!email) throw new NotFoundException('Email not found');
    if (email.project.organizationId !== organizationId) throw new ForbiddenException('Email does not belong to your organization');
    return email;
  }
  async send(id: string, organizationId: string, userId: string) {
    const email = await this.ownedEmail(id, organizationId);
    if (!email.recipientEmail) throw new BadRequestException('Recipient email missing');
    this.assertConfigured();
    // Atomic claim: only one request can take an unsent email, so a double click or a retry cannot send it twice.
    const claim = await this.prisma.generatedEmail.updateMany({ where: { id, sentAt: null, status: { in: UNSENT } }, data: { sentAt: new Date() } });
    if (!claim.count) throw new ConflictException('Ce mail a déjà été envoyé ou est en cours d’envoi.');
    // Only the provider call can put the email back in error: once the provider has accepted it, it must never look unsent.
    let providerMessageId: string | undefined;
    try {
      providerMessageId = (await this.mailer.send({ to: email.recipientEmail, subject: email.subject, ...(await this.render(email, email.subject)) })).id;
    } catch (e: any) {
      const reason = typeof e?.message === 'string' && e.message.trim() ? e.message : 'Unknown email error';
      this.logger.error(`Email ${id} could not be sent: ${reason}`);
      await this.prisma.generatedEmail.update({ where: { id }, data: { status: 'ERROR', sentAt: null, errorMessage: reason } });
      await this.prisma.activityLog.create({ data: { projectId: email.projectId, userId, action: 'Échec de l’envoi du mail', entityType: 'GeneratedEmail', entityId: id, metadata: { recipient: email.recipientEmail, observationId: email.observationId } } });
      throw new BadGatewayException(`${(e instanceof MailSendError && e.userMessage) || 'L’envoi du mail a échoué.'} Le brouillon est conservé : vous pouvez réessayer.`);
    }
    const updated = await this.prisma.generatedEmail.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), providerMessageId, errorMessage: null } });
    let companyName: string | null = null;
    if (email.observationId) {
      const observation = await this.prisma.observation.findUnique({ where: { id: email.observationId }, include: { company: { select: { name: true } } } });
      companyName = observation?.company?.name ?? null;
      if (observation && observation.status !== 'RESOLVED' && observation.status !== 'SENT') {
        await this.prisma.observation.update({ where: { id: observation.id }, data: { status: 'SENT' } });
        await this.prisma.observationHistory.create({ data: { observationId: observation.id, fromStatus: observation.status, toStatus: 'SENT', note: `Mail envoyé à ${companyName || 'l’entreprise'} (${email.recipientEmail})` } });
      }
    }
    await this.prisma.activityLog.create({ data: { projectId: email.projectId, userId, action: companyName ? `Mail envoyé à ${companyName}` : 'Mail envoyé', entityType: 'GeneratedEmail', entityId: id, metadata: { recipient: email.recipientEmail, companyName, observationId: email.observationId } } });
    return updated;
  }
  async sendDrafts(organizationId: string, userId: string, projectId?: string) {
    const drafts = await this.prisma.generatedEmail.findMany({ where: { status: 'DRAFT', ...(projectId ? { projectId } : {}), project: { organizationId } } });
    const results: Array<{id:string;ok:boolean;error?:string}> = [];
    for (const d of drafts) { try { await this.send(d.id, organizationId, userId); results.push({ id: d.id, ok: true }); } catch (e:any) { results.push({ id: d.id, ok: false, error: e?.message }); } }
    return { total: drafts.length, results };
  }
  async remind(id: string, organizationId: string, userId: string) {
    const email = await this.ownedEmail(id, organizationId);
    if (!email.recipientEmail) throw new BadRequestException('Recipient email missing');
    this.assertConfigured();
    const subject = email.subject.startsWith('Relance') ? email.subject : `Relance - ${email.subject}`;
    try {
      await this.mailer.send({ to: email.recipientEmail, subject, ...(await this.render(email, subject, { level: 0 })) });
    } catch (e: any) {
      this.logger.error(`Reminder for email ${id} could not be sent: ${e?.message}`);
      throw new BadGatewayException(`${(e instanceof MailSendError && e.userMessage) || 'L’envoi de la relance a échoué.'} Merci de réessayer.`);
    }
    const updated = await this.prisma.generatedEmail.update({ where: { id }, data: { lastRemindedAt: new Date(), reminderCount: { increment: 1 } } });
    if (email.observationId) {
      const observation = await this.prisma.observation.findUnique({ where: { id: email.observationId } });
      if (observation && observation.status !== 'RESOLVED' && observation.status !== 'TO_RELAUNCH') {
        await this.prisma.observation.update({ where: { id: observation.id }, data: { status: 'TO_RELAUNCH' } });
        await this.prisma.observationHistory.create({ data: { observationId: observation.id, fromStatus: observation.status, toStatus: 'TO_RELAUNCH', note: 'Relance envoyée à l’entreprise' } });
      }
    }
    await this.prisma.activityLog.create({ data: { projectId: email.projectId, userId, action: 'Relance envoyée', entityType: 'GeneratedEmail', entityId: id } });
    return updated;
  }
  async resolve(token: string) {
    const email = await this.prisma.generatedEmail.findUnique({ where: { resolveToken: token }, include: { observation: true } });
    if (!email) throw new NotFoundException('Resolve link invalid');
    const now = new Date();
    const updated = await this.prisma.generatedEmail.update({ where: { id: email.id }, data: { status: 'RESOLVED', resolvedAt: now } });
    if (email.observationId && email.observation && email.observation.status !== 'RESOLVED') {
      await this.prisma.observation.update({ where: { id: email.observationId }, data: { status: 'RESOLVED' } });
      await this.prisma.observationHistory.create({ data: { observationId: email.observationId, fromStatus: email.observation.status, toStatus: 'RESOLVED', note: 'Clôturé via lien destinataire' } });
    }
    await this.prisma.activityLog.create({ data: { projectId: email.projectId, action: 'Mail / observation clôturé via lien destinataire', entityType: 'GeneratedEmail', entityId: email.id } });
    return updated;
  }

  // ---- Direct "send this observation to a company" workflow ----

  private async ownedObservation(observationId: string, organizationId: string) {
    const observation = await this.prisma.observation.findFirst({
      where: { id: observationId, project: { organizationId } },
      include: {
        project: { select: { id: true, name: true, organization: { select: { name: true } } } },
        lot: true,
        company: true,
        report: { select: { id: true, issuer: true, document: { select: { name: true } } } },
        generatedEmails: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!observation) throw new NotFoundException('Observation not found');
    return observation;
  }

  // Scoped to the caller's organization: a company from another organization is reported as not found.
  private async ownedCompany(companyId: string, organizationId: string) {
    const company = await this.prisma.company.findFirst({ where: { id: companyId, organizationId } });
    if (!company) throw new NotFoundException('Entreprise introuvable');
    return company;
  }

  private buildDraft(observation: Awaited<ReturnType<EmailsService['ownedObservation']>>, companyName: string | null) {
    const source = observation.report
      ? [observation.report.document?.name || 'Rapport Bureau de Contrôle', observation.sourcePage ? `page ${observation.sourcePage}` : null].filter(Boolean).join(', ')
      : null;
    const due = observation.dueDate ? observation.dueDate.toLocaleDateString('fr-FR') : null;
    const body = [
      'Bonjour,',
      '',
      `Dans le cadre du projet « ${observation.project.name} », nous vous transmettons l'observation ci-dessous${companyName ? `, qui concerne votre entreprise ${companyName}` : ''}.`,
      '',
      `Observation : ${observation.title}`,
      observation.reference ? `Référence : ${observation.reference}` : null,
      observation.lot ? `Lot : ${observation.lot.name}` : null,
      `Gravité : ${SEVERITY_FR[observation.severity] || observation.severity}`,
      source ? `Source : ${source}` : null,
      due ? `Échéance : ${due}` : null,
      '',
      'Description :',
      observation.description,
      '',
      'Action attendue :',
      observation.requiredAction || 'Merci de nous indiquer les mesures correctives prévues.',
      '',
      `Merci de nous transmettre votre réponse ainsi que les justificatifs de correction${due ? ` avant le ${due}` : ''}.`,
      '',
      'Cordialement,',
      observation.project.organization.name,
    ].filter(line => line !== null).join('\n');
    return { subject: `[SOWEN] ${observation.project.name} - ${observation.title}`, body };
  }

  async compose(observationId: string, organizationId: string, companyId?: string) {
    const observation = await this.ownedObservation(observationId, organizationId);
    const companies = await this.prisma.company.findMany({ where: { organizationId }, select: { id: true, name: true, email: true, contactName: true }, orderBy: { name: 'asc' } });
    let selectedCompanyId: string | null = null;
    if (companyId) {
      if (!companies.some(c => c.id === companyId)) throw new NotFoundException('Entreprise introuvable');
      selectedCompanyId = companyId;
    } else if (observation.companyId) {
      selectedCompanyId = observation.companyId;
    } else if (observation.lotId) {
      const projectLot = await this.prisma.projectLot.findUnique({ where: { projectId_lotId: { projectId: observation.projectId, lotId: observation.lotId } } });
      selectedCompanyId = projectLot?.companyId ?? null;
    }
    const selected = companies.find(c => c.id === selectedCompanyId) || null;
    const saved = observation.generatedEmails.find(e => UNSENT.includes(e.status) && !e.sentAt) || null;
    const lastSent = observation.generatedEmails.find(e => e.sentAt && e.status !== 'ERROR') || null;
    // Drafts created automatically with the observation are replaced by the richer generated text;
    // only a draft the user saved (or tried to send) is offered back as is.
    const userEdited = saved
      ? saved.status === 'ERROR' || Boolean(await this.prisma.activityLog.findFirst({ where: { entityType: 'GeneratedEmail', entityId: saved.id, action: { startsWith: DRAFT_SAVED_ACTION } }, select: { id: true } }))
      : false;
    return {
      observation: {
        id: observation.id,
        title: observation.title,
        description: observation.description,
        reference: observation.reference,
        requiredAction: observation.requiredAction,
        severity: observation.severity,
        status: observation.status,
        sourcePage: observation.sourcePage,
        dueDate: observation.dueDate,
        companyId: observation.companyId,
        project: { id: observation.project.id, name: observation.project.name },
        lot: observation.lot ? { id: observation.lot.id, name: observation.lot.name } : null,
        report: observation.report ? { id: observation.report.id, name: observation.report.document?.name ?? null, issuer: observation.report.issuer } : null,
      },
      companies,
      selectedCompanyId: selected?.id ?? null,
      draft: this.buildDraft(observation, selected?.name ?? null),
      savedDraft: saved ? { id: saved.id, subject: saved.subject, body: saved.body, recipientEmail: saved.recipientEmail, status: saved.status, userEdited } : null,
      lastSent: lastSent ? { id: lastSent.id, recipientEmail: lastSent.recipientEmail, sentAt: lastSent.sentAt, companyName: observation.company?.name ?? null } : null,
      emailConfigured: this.isConfigured(),
    };
  }

  async saveDraft(observationId: string, dto: ObservationEmailDto, organizationId: string, userId: string, log = true) {
    const observation = await this.ownedObservation(observationId, organizationId);
    const company = await this.ownedCompany(dto.companyId, organizationId);
    const subject = dto.subject.trim();
    const body = dto.body.trim();
    if (!subject || !body) throw new BadRequestException('L’objet et le message sont obligatoires.');
    const data = { recipientEmail: company.email || null, subject, body, dueDate: observation.dueDate, status: (company.email ? 'DRAFT' : 'NEEDS_RECIPIENT') as EmailStatus, errorMessage: null };
    const existing = observation.generatedEmails.find(e => UNSENT.includes(e.status) && !e.sentAt);
    let emailId: string;
    if (existing) {
      // sentAt: null keeps a draft that is being sent right now from being rewritten.
      const changed = await this.prisma.generatedEmail.updateMany({ where: { id: existing.id, sentAt: null, status: { in: UNSENT } }, data });
      if (!changed.count) throw new ConflictException('Ce mail a déjà été envoyé ou est en cours d’envoi.');
      emailId = existing.id;
    } else {
      emailId = (await this.prisma.generatedEmail.create({ data: { projectId: observation.projectId, observationId, ...data } })).id;
    }
    if (observation.companyId !== company.id) await this.prisma.observation.update({ where: { id: observationId }, data: { companyId: company.id } });
    if (log) {
      await this.prisma.activityLog.create({ data: { projectId: observation.projectId, userId, action: `${DRAFT_SAVED_ACTION} pour ${company.name}`, entityType: 'GeneratedEmail', entityId: emailId, metadata: { observationId, companyId: company.id, recipient: company.email } } });
    }
    return this.prisma.generatedEmail.findUniqueOrThrow({ where: { id: emailId } });
  }

  async sendToCompany(observationId: string, dto: SendObservationEmailDto, organizationId: string, userId: string) {
    if (!this.isConfigured()) throw new BadRequestException('L’envoi d’emails n’est pas configuré. Vous pouvez enregistrer le brouillon.');
    if (this.sending.has(observationId)) throw new ConflictException('Un envoi est déjà en cours pour cette observation.');
    this.sending.add(observationId);
    try {
      const observation = await this.ownedObservation(observationId, organizationId);
      const company = await this.ownedCompany(dto.companyId, organizationId);
      if (!company.email) throw new BadRequestException('Cette entreprise n’a pas d’adresse email.');
      const alreadySent = observation.generatedEmails.some(e => e.sentAt && e.status !== 'ERROR' && e.recipientEmail === company.email);
      if (alreadySent && !dto.allowResend) throw new ConflictException('Cette observation a déjà été envoyée à cette entreprise.');
      const draft = await this.saveDraft(observationId, dto, organizationId, userId, false);
      const email = await this.send(draft.id, organizationId, userId);
      return { email, company: { id: company.id, name: company.name, email: company.email } };
    } finally {
      this.sending.delete(observationId);
    }
  }
}
