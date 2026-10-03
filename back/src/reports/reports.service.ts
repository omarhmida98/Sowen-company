import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, StreamableFile } from '@nestjs/common';
import pdf from 'pdf-parse';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { StorageService } from '../storage/storage.service';
import { REPORT_ANALYSIS_SCHEMA, REPORT_ANALYSIS_SYSTEM, VALID_SEVERITIES, documentAnalysisOf, validateReportAnalysis } from './report-analysis';

const AUTO_ACTION_CONFIDENCE = 0.75;
const SEVERITIES: readonly string[] = VALID_SEVERITIES;
const PAGE_MARKER = /\[\[PAGE \d+\]\]/g;

// Same text layout as pdf-parse's default renderer, prefixed with a page marker so the AI can cite real page numbers.
async function renderPageWithMarker(pageData: any): Promise<string> {
  const content = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
  let lastY: number | undefined;
  let text = '';
  for (const item of content.items) {
    text += lastY === item.transform[5] || !lastY ? item.str : `\n${item.str}`;
    lastY = item.transform[5];
  }
  return `[[PAGE ${pageData.pageIndex + 1}]]\n${text}`;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private prisma: PrismaService, private ai: AiService, private storage: StorageService) {}

  list(organizationId: string, projectId?: string) {
    return this.prisma.controlReport.findMany({
      where: { ...(projectId ? { projectId } : {}), project: { organizationId } },
      include: { project: true, document: true, _count: { select: { observations: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async detail(reportId: string, organizationId: string) {
    const report = await this.prisma.controlReport.findFirst({
      where: { id: reportId, project: { organizationId } },
      include: {
        project: { select: { id: true, name: true, buildingType: true, status: true } },
        document: { select: { id: true, name: true, mimeType: true, sizeBytes: true, uploadedAt: true } },
        observations: {
          include: { lot: true, company: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!report) throw new NotFoundException('Report not found');
    const raw: any = report.rawAiResult || null;
    const items = raw && Array.isArray(raw.observations) ? raw.observations : [];
    const aligned = report.observations.length === items.length;
    return {
      id: report.id,
      projectId: report.projectId,
      project: report.project,
      document: report.document,
      issuer: report.issuer,
      reportDate: report.reportDate,
      createdAt: report.createdAt,
      analyzedAt: report.analyzedAt,
      analysisStatus: report.analysisStatus,
      analysisError: report.analysisError,
      aiModel: report.aiModel,
      aiConfidence: report.aiConfidence,
      observationCount: report.observationCount,
      rawTextLength: (report.rawText || '').replace(PAGE_MARKER, '').length,
      aiConfigured: this.ai.isConfigured(),
      aiProvider: this.ai.provider(),
      configuredModel: this.ai.model(),
      analysis: documentAnalysisOf(raw),
      detectedObservations: items.length,
      observations: report.observations.map((o, idx) => {
        const rawItem = aligned ? items[idx] || {} : {};
        return {
          ...o,
          category: typeof rawItem.category === 'string' ? rawItem.category : null,
          suggestedLotName: typeof rawItem.lotName === 'string' ? rawItem.lotName : null,
          suggestedCompanyName: typeof rawItem.companyName === 'string' ? rawItem.companyName : null,
        };
      }),
    };
  }

  async downloadFile(reportId: string, organizationId: string) {
    const report = await this.prisma.controlReport.findFirst({
      where: { id: reportId, project: { organizationId } },
      select: { document: { select: { name: true, mimeType: true, storageKey: true } } },
    });
    if (!report) throw new NotFoundException('Report not found');
    const storageKey = report.document?.storageKey;
    if (!storageKey) throw new NotFoundException('Report file not found');
    let buffer: Buffer;
    try {
      buffer = await this.storage.read(storageKey);
    } catch (error) {
      if (error instanceof NotFoundException) throw new NotFoundException('Report file not found');
      throw error;
    }
    return new StreamableFile(buffer, {
      type: report.document?.mimeType || 'application/pdf',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(report.document?.name || 'report.pdf')}`,
    });
  }

  async analyzeText(projectId: string, text: string, organizationId: string) {
    await this.assertProject(projectId, organizationId);
    const [projectLots, companies] = await Promise.all([
      this.prisma.projectLot.findMany({ where: { projectId }, include: { lot: true } }),
      this.prisma.company.findMany({ where: { organizationId }, select: { name: true } }),
    ]);
    const known = [
      projectLots.length ? `Known lots for this project: ${projectLots.map(pl => pl.lot.name).join(' | ')}` : null,
      companies.length ? `Known companies: ${companies.map(c => c.name).join(' | ')}` : null,
    ].filter(Boolean).join('\n');
    const { data, model } = await this.ai.json<unknown>(
      REPORT_ANALYSIS_SYSTEM,
      `${known ? `${known}\n\n` : ''}<document>\n${text}\n</document>`,
      REPORT_ANALYSIS_SCHEMA,
    );
    return { projectId, result: validateReportAnalysis(data), model };
  }

  async uploadAndAnalyze(projectId: string, issuer: string | undefined, file: Express.Multer.File, organizationId: string, userId: string) {
    await this.assertProject(projectId, organizationId);
    if (file.mimetype !== 'application/pdf' && !file.originalname.toLowerCase().endsWith('.pdf')) {
      throw new BadRequestException('Only PDF reports are supported');
    }

    const storageKey = await this.storage.save({ projectId, folder: 'reports', originalName: file.originalname, buffer: file.buffer, contentType: file.mimetype });
    this.logger.log(`Report file stored as ${storageKey} (${file.size} bytes)`);

    let parsedText = '';
    let pdfError: string | null = null;
    try {
      const parsedPdf = await pdf(file.buffer, { pagerender: renderPageWithMarker });
      parsedText = parsedPdf.text || '';
      if (!parsedText.replace(PAGE_MARKER, '').trim()) {
        parsedText = '';
        pdfError = "Aucun texte exploitable n'a pu être extrait de ce PDF (document scanné ou vide).";
      }
    } catch (error: any) {
      pdfError = typeof error?.message === 'string' && error.message.trim() ? error.message : 'PDF text extraction failed';
      this.logger.error(`PDF extraction failed for ${storageKey}: ${error?.stack || pdfError}`);
    }

    const document = await this.prisma.document.create({
      data: { projectId, type: 'CONTROL_REPORT', name: file.originalname, storageKey, mimeType: file.mimetype, sizeBytes: file.size },
    });
    const analysisStatus = pdfError ? 'FAILED' : this.ai.isConfigured() ? 'PROCESSING' : 'PENDING';
    const report = await this.prisma.controlReport.create({
      data: {
        projectId,
        documentId: document.id,
        issuer: issuer || null,
        rawText: parsedText,
        analysisStatus,
        analysisError: pdfError,
      },
    });
    await this.prisma.activityLog.create({
      data: { projectId, userId, action: 'Rapport Bureau de Contrôle importé', entityType: 'ControlReport', entityId: report.id },
    });

    if (!this.ai.isConfigured()) {
      this.logger.log(`Report ${report.id} saved (analysis PENDING: ANTHROPIC_API_KEY not configured)`);
      return {
        report,
        document,
        extractedTextLength: parsedText.replace(PAGE_MARKER, '').length,
        aiConfigured: false,
        createdObservations: 0,
        createdDrafts: 0,
        analysisStatus,
        analysisError: pdfError,
      };
    }
    if (pdfError) {
      this.logger.warn(`Report ${report.id} saved but PDF text could not be extracted; AI analysis skipped`);
      return {
        report,
        document,
        extractedTextLength: 0,
        aiConfigured: true,
        createdObservations: 0,
        createdDrafts: 0,
        analysisStatus: 'FAILED',
        analysisError: pdfError,
      };
    }
    return this.runAnalysis(report.id, projectId, parsedText, organizationId, userId, {
      documentId: document.id,
      extractedTextLength: parsedText.replace(PAGE_MARKER, '').length,
    });
  }

  async reanalyze(reportId: string, organizationId: string, userId: string) {
    const report = await this.prisma.controlReport.findFirst({ where: { id: reportId, project: { organizationId } } });
    if (!report) throw new NotFoundException('Report not found');
    if (!report.rawText?.trim()) throw new BadRequestException('No extracted text is available for this report');
    if (!this.ai.isConfigured()) throw new BadRequestException('ANTHROPIC_API_KEY is not configured yet');
    await this.prisma.generatedEmail.deleteMany({ where: { observation: { reportId } } });
    await this.prisma.observation.deleteMany({ where: { reportId } });
    await this.prisma.controlReport.update({
      where: { id: reportId },
      data: { analysisStatus: 'PROCESSING', analysisError: null, observationCount: 0, aiConfidence: null, rawAiResult: undefined },
    });
    return this.runAnalysis(reportId, report.projectId, report.rawText, organizationId, userId, {});
  }

  async materialize(reportId: string, organizationId: string, userId: string) {
    const report = await this.prisma.controlReport.findFirst({
      where: { id: reportId, project: { organizationId } },
      include: {
        project: { include: { organization: true, lots: { include: { lot: true, company: true } } } },
      },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (report.analysisStatus === 'PENDING') throw new BadRequestException("Veuillez d'abord relancer l'analyse IA de ce rapport.");
    if (report.analysisStatus === 'PROCESSING') throw new BadRequestException("L'analyse IA de ce rapport est en cours. Patientez quelques instants.");
    const raw: any = report.rawAiResult || null;
    const items = raw && Array.isArray(raw.observations) ? raw.observations : [];
    if (!items.length) throw new BadRequestException("Aucun résultat IA à matérialiser. Relancez l'analyse IA de ce rapport.");
    if (report.observationCount > 0) {
      return { alreadyMaterialized: true, created: 0, needsRecipient: 0, needsValidation: 0, needsReview: report.analysisStatus === 'NEEDS_REVIEW' };
    }

    const project = report.project;
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
      } else if (!recipientEmail && matchedProjectLot && matchedProjectLot.companyId === companyId) {
        recipientEmail = matchedProjectLot.contactEmail || matchedProjectLot.company?.email || null;
      }

      const confidence = typeof item.confidence === 'number' && Number.isFinite(item.confidence)
        ? Math.max(0, Math.min(1, item.confidence))
        : null;
      if (confidence != null) confidences.push(confidence);
      const sourcePage = typeof item.sourcePage === 'number' && Number.isFinite(item.sourcePage) && item.sourcePage > 0
        ? Math.round(item.sourcePage)
        : null;
      const severity = SEVERITIES.includes(String(item.severity)) ? String(item.severity) as any : 'MEDIUM';
      const safeForAutomation = confidence !== null && confidence >= AUTO_ACTION_CONFIDENCE;
      if (!safeForAutomation) needsValidation++;

      const observation = await this.prisma.observation.create({
        data: {
          projectId: report.projectId,
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
          note: 'Observation matérialisée depuis le résultat IA du rapport',
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
            projectId: report.projectId,
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
    const needsReview = needsValidation > 0 || items.some((x: any) => x.confidence == null);
    const status = needsReview ? 'NEEDS_REVIEW' : 'COMPLETED';
    await this.prisma.controlReport.update({
      where: { id: reportId },
      data: { observationCount: created, aiConfidence: avgConfidence, analysisStatus: status, analysisError: null },
    });
    await this.prisma.activityLog.create({
      data: {
        projectId: report.projectId,
        userId,
        action: `Observations matérialisées (${created}), ${createdDrafts} brouillon(s) généré(s)`,
        entityType: 'ControlReport',
        entityId: reportId,
        metadata: { aiModel: report.aiModel, averageConfidence: avgConfidence, needsReview, createdDrafts, needsRecipient, autoAssigned, needsValidation },
      },
    });
    this.logger.log(`Observations materialized for report ${reportId} (${created}, status ${status})`);
    return { alreadyMaterialized: false, created, createdDrafts, needsRecipient, needsValidation, needsReview, avgConfidence };
  }

  private async runAnalysis(reportId: string, projectId: string, text: string, organizationId: string, userId: string, extra: Record<string, unknown>) {
    this.logger.log(`Starting AI analysis for report ${reportId}`);
    try {
      const analyzed = await this.analyzeText(projectId, text, organizationId);
      const items = analyzed.result.observations;
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
        } else if (!recipientEmail && matchedProjectLot && matchedProjectLot.companyId === companyId) {
          recipientEmail = matchedProjectLot.contactEmail || matchedProjectLot.company?.email || null;
        }

        const confidence = typeof item.confidence === 'number' && Number.isFinite(item.confidence)
          ? Math.max(0, Math.min(1, item.confidence))
          : null;
        if (confidence != null) confidences.push(confidence);
        const sourcePage = typeof item.sourcePage === 'number' && Number.isFinite(item.sourcePage) && item.sourcePage > 0
          ? Math.round(item.sourcePage)
          : null;
        const severity = SEVERITIES.includes(String(item.severity)) ? String(item.severity) as any : 'MEDIUM';
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

      // Without observations, the report-level confidence is the document analysis confidence.
      const avgConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : analyzed.result.confidence;
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
      this.logger.log(`AI analysis completed for report ${reportId} (${status}, ${created} observation(s), ${createdDrafts} brouillon(s))`);
      return {
        reportId,
        ...extra,
        aiConfigured: true,
        aiProvider: this.ai.provider(),
        aiModel: analyzed.model,
        aiConfidence: avgConfidence,
        documentType: analyzed.result.documentType,
        summary: analyzed.result.summary,
        analysisStatus: status,
        createdObservations: created,
        createdDrafts,
        needsRecipient,
        autoAssigned,
        needsValidation,
        needsReview,
      };
    } catch (error: any) {
      const message = typeof error?.message === 'string' && error.message.trim() ? error.message : 'AI analysis failed';
      this.logger.error(`AI analysis failed for report ${reportId}: ${error?.stack || message}`);
      await this.prisma.controlReport.update({
        where: { id: reportId },
        data: { analysisStatus: 'FAILED', analysisError: message },
      }).catch(() => {});
      return {
        reportId,
        ...extra,
        aiConfigured: true,
        aiModel: null,
        aiConfidence: null,
        analysisStatus: 'FAILED' as const,
        analysisError: message,
        createdObservations: 0,
        createdDrafts: 0,
        needsRecipient: 0,
        autoAssigned: 0,
        needsValidation: 0,
        needsReview: true,
      };
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
