import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import pdf from 'pdf-parse';
import { promises as fs } from 'fs';
import path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

const VALID_SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const AUTO_ACTION_CONFIDENCE = 0.75;

type AiObservation = {
  title?: string;
  description?: string;
  reference?: string | null;
  requiredAction?: string | null;
  lotName?: string | null;
  companyName?: string | null;
  severity?: string;
  sourcePage?: number | null;
  confidence?: number | null;
};

type ReportAiResult = { observations?: AiObservation[] };

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService, private ai: AiService) {}

  list(organizationId: string, projectId?: string) {
    return this.prisma.controlReport.findMany({
      where: { ...(projectId ? { projectId } : {}), project: { organizationId } },
      include: { project: true, document: true, _count: { select: { observations: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async analyzeText(projectId: string, text: string, organizationId: string) {
    await this.assertProject(projectId, organizationId);
    const { data, model } = await this.ai.json<ReportAiResult>(
      'You analyze French construction Bureau de Contrôle reports. Extract only observations actually present in the text. Return strict JSON with an observations array. Each item must contain: title, description, reference, requiredAction, lotName, companyName, severity, sourcePage, confidence. confidence is a number from 0 to 1. severity must be INFO, LOW, MEDIUM, HIGH or CRITICAL. Never invent a regulation reference, company, lot, page number or required action; use null when absent. Keep the original technical meaning.',
      text,
    );
    return { projectId, result: data, model };
  }

  async uploadAndAnalyze(projectId: string, issuer: string | undefined, file: Express.Multer.File, organizationId: string, userId: string) {
    await this.assertProject(projectId, organizationId);
    if (file.mimetype !== 'application/pdf' && !file.originalname.toLowerCase().endsWith('.pdf')) {
      throw new BadRequestException('Only PDF reports are supported');
    }

    const dir = path.resolve(process.cwd(), 'uploads', projectId, 'reports');
    await fs.mkdir(dir, { recursive: true });
    const safe = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const full = path.join(dir, safe);
    await fs.writeFile(full, file.buffer);

    const parsedPdf = await pdf(file.buffer);
    const document = await this.prisma.document.create({
      data: { projectId, type: 'CONTROL_REPORT', name: file.originalname, storageKey: full, mimeType: file.mimetype, sizeBytes: file.size },
    });
    const report = await this.prisma.controlReport.create({
      data: {
        projectId,
        documentId: document.id,
        issuer: issuer || null,
        rawText: parsedPdf.text,
        analysisStatus: this.ai.isConfigured() ? 'PROCESSING' : 'PENDING',
      },
    });
    await this.prisma.activityLog.create({
      data: { projectId, userId, action: 'Rapport Bureau de Contrôle importé', entityType: 'ControlReport', entityId: report.id },
    });

    if (!this.ai.isConfigured()) {
      return {
        report,
        document,
        extractedTextLength: parsedPdf.text.length,
        aiConfigured: false,
        createdObservations: 0,
        createdDrafts: 0,
        analysisStatus: 'PENDING',
      };
    }
    return this.runAnalysis(report.id, projectId, parsedPdf.text, organizationId, userId, {
      documentId: document.id,
      extractedTextLength: parsedPdf.text.length,
    });
  }

  async reanalyze(reportId: string, organizationId: string, userId: string) {
    const report = await this.prisma.controlReport.findFirst({ where: { id: reportId, project: { organizationId } } });
    if (!report) throw new NotFoundException('Report not found');
    if (!report.rawText?.trim()) throw new BadRequestException('No extracted text is available for this report');
    if (!this.ai.isConfigured()) throw new BadRequestException('OPENAI_API_KEY is not configured yet');
    await this.prisma.generatedEmail.deleteMany({ where: { observation: { reportId } } });
    await this.prisma.observation.deleteMany({ where: { reportId } });
    await this.prisma.controlReport.update({
      where: { id: reportId },
      data: { analysisStatus: 'PROCESSING', analysisError: null, observationCount: 0, aiConfidence: null, rawAiResult: undefined },
    });
    return this.runAnalysis(reportId, report.projectId, report.rawText, organizationId, userId, {});
  }

  private async runAnalysis(reportId: string, projectId: string, text: string, organizationId: string, userId: string, extra: Record<string, unknown>) {
    try {
      const analyzed = await this.analyzeText(projectId, text, organizationId);
      const items = Array.isArray(analyzed.result?.observations) ? analyzed.result.observations : [];
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        include: {
          organization: true,
          lots: { include: { lot: true, company: true } },
        },
      });
      if (!project) throw new NotFoundException('Project not found');

      const dueDays = Math.max(1, project.organization.reminderDays || 7);
      const defaultDueDate = new Date(Date.now() + dueDays * 86400000);
      const confidences: number[] = [];
      let created = 0;
      let createdDrafts = 0;
      let needsRecipient = 0;
      let autoAssigned = 0;
      let needsValidation = 0;

      for (const item of items) {
        const title = String(item.title || '').trim();
        const description = String(item.description || '').trim();
        if (!title && !description) continue;

        let lotId: string | undefined;
        let matchedProjectLot: any;
        if (item.lotName) {
          const normalized = String(item.lotName).trim();
          matchedProjectLot = project.lots.find(pl => pl.lot.name.localeCompare(normalized, undefined, { sensitivity: 'accent' }) === 0)
            || project.lots.find(pl => pl.lot.name.toLowerCase().includes(normalized.toLowerCase()) || normalized.toLowerCase().includes(pl.lot.name.toLowerCase()));
          if (matchedProjectLot) lotId = matchedProjectLot.lotId;
          if (!lotId) {
            const lot = await this.prisma.lot.findFirst({ where: { name: { equals: normalized, mode: 'insensitive' } } });
            lotId = lot?.id;
            if (lotId) matchedProjectLot = project.lots.find(pl => pl.lotId === lotId);
          }
        }

        let companyId: string | undefined;
        let recipientEmail: string | null = null;
        if (item.companyName) {
          const company = await this.prisma.company.findFirst({
            where: { organizationId, name: { contains: String(item.companyName), mode: 'insensitive' } },
          });
          companyId = company?.id;
          recipientEmail = company?.email || null;
        }
        if (!companyId && matchedProjectLot?.companyId) {
          companyId = matchedProjectLot.companyId;
          recipientEmail = matchedProjectLot.contactEmail || matchedProjectLot.company?.email || null;
          autoAssigned++;
        } else if (!recipientEmail && matchedProjectLot?.companyId === companyId) {
          recipientEmail = matchedProjectLot.contactEmail || matchedProjectLot.company?.email || null;
        }

        const confidence = typeof item.confidence === 'number' && Number.isFinite(item.confidence)
          ? Math.max(0, Math.min(1, item.confidence))
          : null;
        if (confidence != null) confidences.push(confidence);
        const sourcePage = typeof item.sourcePage === 'number' && Number.isFinite(item.sourcePage) && item.sourcePage > 0
          ? Math.round(item.sourcePage)
          : null;
        const severity = VALID_SEVERITIES.includes(String(item.severity)) ? String(item.severity) as any : 'MEDIUM';
        const safeForAutomation = confidence !== null && confidence >= AUTO_ACTION_CONFIDENCE;
        if (!safeForAutomation) needsValidation++;

        const observation = await this.prisma.observation.create({
          data: {
            projectId,
            reportId,
            lotId,
            companyId,
            originalText: description || title,
            title: title || 'Observation rapport',
            description: description || title,
            reference: item.reference ? String(item.reference) : null,
            requiredAction: item.requiredAction ? String(item.requiredAction) : null,
            severity,
            sourcePage,
            aiConfidence: confidence,
            dueDate: safeForAutomation ? defaultDueDate : null,
            status: safeForAutomation ? (recipientEmail ? 'TO_SEND' : 'OPEN') : 'OPEN',
          },
        });
        created++;

        await this.prisma.observationHistory.create({
          data: {
            observationId: observation.id,
            toStatus: observation.status,
            note: safeForAutomation
              ? 'Observation créée automatiquement depuis le rapport BC'
              : 'Observation IA créée et mise en attente de validation humaine',
          },
        });

        if (safeForAutomation) {
          const body = this.buildObservationEmail({
            projectName: project.name,
            lotName: matchedProjectLot?.lot.name,
            title: observation.title,
            description: observation.description,
            reference: observation.reference || undefined,
            requiredAction: observation.requiredAction || undefined,
            dueDate: defaultDueDate,
            issuer: project.name,
          });
          await this.prisma.generatedEmail.create({
            data: {
              projectId,
              observationId: observation.id,
              recipientEmail,
              dueDate: defaultDueDate,
              subject: `[SOWEN] Observation Bureau de Contrôle - ${project.name} - ${observation.title}`,
              body,
              status: recipientEmail ? 'DRAFT' : 'NEEDS_RECIPIENT',
            },
          });
          if (recipientEmail) createdDrafts++; else needsRecipient++;
        }
      }

      const avgConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;
      const needsReview = needsValidation > 0 || items.some(x => x.confidence == null);
      const status = needsReview ? 'NEEDS_REVIEW' : 'COMPLETED';
      await this.prisma.controlReport.update({
        where: { id: reportId },
        data: {
          analyzedAt: new Date(),
          analysisStatus: status,
          aiModel: analyzed.model,
          aiConfidence: avgConfidence,
          observationCount: created,
          rawAiResult: analyzed.result as any,
          analysisError: null,
        },
      });
      await this.prisma.activityLog.create({
        data: {
          projectId,
          userId,
          action: `Analyse IA terminée (${created} observation(s), ${createdDrafts} brouillon(s))`,
          entityType: 'ControlReport',
          entityId: reportId,
          metadata: { aiModel: analyzed.model, averageConfidence: avgConfidence, needsReview, createdDrafts, needsRecipient, autoAssigned, needsValidation },
        },
      });
      return {
        reportId,
        ...extra,
        aiConfigured: true,
        aiModel: analyzed.model,
        aiConfidence: avgConfidence,
        analysisStatus: status,
        createdObservations: created,
        createdDrafts,
        needsRecipient,
        autoAssigned,
        needsValidation,
        needsReview,
      };
    } catch (error: any) {
      await this.prisma.controlReport.update({
        where: { id: reportId },
        data: { analysisStatus: 'FAILED', analysisError: error?.message || 'AI analysis failed' },
      }).catch(() => {});
      throw error;
    }
  }

  private buildObservationEmail(input: {
    projectName: string;
    lotName?: string | null;
    title: string;
    description: string;
    reference?: string;
    requiredAction?: string;
    dueDate: Date;
    issuer?: string;
  }) {
    return [
      'Bonjour,',
      '',
      `Projet : ${input.projectName}`,
      `Lot : ${input.lotName || 'À préciser'}`,
      `Échéance : ${input.dueDate.toLocaleDateString('fr-FR')}`,
      '',
      `Observation : ${input.title}`,
      input.description,
      input.reference ? `Référence : ${input.reference}` : null,
      input.requiredAction ? `Action attendue : ${input.requiredAction}` : null,
      '',
      'Merci de nous transmettre votre retour ainsi que les justificatifs nécessaires.',
      '',
      'Cordialement,',
      'SOWEN',
    ].filter(x => x !== null).join('\n');
  }

  private async assertProject(projectId: string, organizationId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { organizationId: true } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.organizationId !== organizationId) throw new ForbiddenException('Project does not belong to your organization');
  }
}
