import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class EmailsService {
  constructor(private prisma: PrismaService, private config: ConfigService) {}
  list(organizationId: string, projectId?: string) { return this.prisma.generatedEmail.findMany({ where: { ...(projectId ? { projectId } : {}), project: { organizationId } }, include: { observation: { include: { company: true, lot: true } } }, orderBy: { createdAt: 'desc' } }); }
  private client() {
    const key = this.config.get<string>('RESEND_API_KEY');
    const from = this.config.get<string>('RESEND_FROM');
    if (!key || !from) throw new BadRequestException('RESEND_API_KEY / RESEND_FROM not configured');
    return { resend: new Resend(key), from };
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
    const { resend, from } = this.client();
    try {
      const sent = await resend.emails.send({ from, to: email.recipientEmail, subject: email.subject, html: email.body.replace(/\n/g, '<br/>') });
      const updated = await this.prisma.generatedEmail.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), providerMessageId: sent.data?.id ?? undefined, errorMessage: null } });
      if (email.observationId) {
        const observation = await this.prisma.observation.findUnique({ where: { id: email.observationId } });
        if (observation && observation.status !== 'RESOLVED' && observation.status !== 'SENT') {
          await this.prisma.observation.update({ where: { id: observation.id }, data: { status: 'SENT' } });
          await this.prisma.observationHistory.create({ data: { observationId: observation.id, fromStatus: observation.status, toStatus: 'SENT', note: 'Mail envoyé à l’entreprise' } });
        }
      }
      await this.prisma.activityLog.create({ data: { projectId: email.projectId, userId, action: 'Mail envoyé', entityType: 'GeneratedEmail', entityId: id } });
      return updated;
    } catch (e: any) {
      await this.prisma.generatedEmail.update({ where: { id }, data: { status: 'ERROR', errorMessage: e?.message ?? 'Unknown email error' } });
      throw e;
    }
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
    const { resend, from } = this.client();
    const subject = email.subject.startsWith('Relance') ? email.subject : `Relance - ${email.subject}`;
    await resend.emails.send({ from, to: email.recipientEmail, subject, html: `Bonjour,<br/><br/>Nous vous relançons concernant le point ci-dessous :<br/><br/>${email.body.replace(/\n/g,'<br/>')}<br/><br/>Merci pour votre retour.` });
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
}
