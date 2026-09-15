import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

type PrecheckAi = {
  workTypes?: string[];
  risks?: string[];
  documentsRequired?: string[];
  contractorInstructions?: string[];
  keywords?: string[];
  confidence?: number;
};

@Injectable()
export class ComplianceService {
  constructor(private prisma: PrismaService, private ai: AiService) {}

  async precheck(projectId: string, rawText: string, lotId: string | undefined, organizationId: string, userId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.organizationId !== organizationId) throw new ForbiddenException('Project does not belong to your organization');

    let structured: PrecheckAi | null = null;
    let aiModel: string | null = null;
    if (this.ai.isConfigured()) {
      try {
        const result = await this.ai.json<PrecheckAi>(
          'You are a construction compliance pre-check assistant for French building projects. Extract facts and practical risks only from the work description and project context. Return strict JSON: {workTypes:string[], risks:string[], documentsRequired:string[], contractorInstructions:string[], keywords:string[], confidence:number}. confidence is 0 to 1. Never invent legal or standards references. Do not claim compliance; identify items to verify.',
          `Building type: ${project.buildingType}\nERP type: ${project.erpType || 'n/a'}\nCategory: ${project.category || 'n/a'}\nWork description: ${rawText}`,
        );
        structured = result.data;
        aiModel = result.model;
      } catch {
        structured = null;
      }
    }

    const aiConfidence = typeof structured?.confidence === 'number' && Number.isFinite(structured.confidence)
      ? Math.max(0, Math.min(1, structured.confidence))
      : null;

    const wd = await this.prisma.workDescription.create({
      data: {
        projectId,
        rawText,
        structuredContext: structured || undefined,
        aiModel,
        aiConfidence,
      },
    });

    const rules = await this.prisma.rule.findMany({
      where: {
        active: true,
        actionable: true,
        ...(lotId ? { OR: [{ lotId }, { lotId: null }] } : {}),
        AND: [
          { OR: [{ buildingType: project.buildingType }, { buildingType: null }] },
          { OR: [{ erpType: project.erpType }, { erpType: null }] },
        ],
      },
      include: { lot: true, source: true },
      orderBy: [{ severity: 'desc' }, { title: 'asc' }],
    });

    const terms = [rawText, ...(structured?.keywords || []), ...(structured?.workTypes || [])].join(' ').toLowerCase();
    const words = [...new Set(terms.split(/\W+/).filter((x: string) => x.length > 3))];
    const ranked = rules
      .map(r => {
        const hay = [r.title, r.summary, r.requirement, r.workType, r.domain, r.condition, r.controlPoint, r.evidenceRequired]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        let relevance = 0;
        for (const word of words) if (hay.includes(word)) relevance++;
        return { ...r, relevance };
      })
      .sort((a, b) => b.relevance - a.relevance);

    for (const r of ranked) {
      const confidence = structured ? Math.min(0.98, 0.60 + r.relevance * 0.04 + (aiConfidence || 0) * 0.15) : null;
      await this.prisma.complianceCheck.upsert({
        where: { projectId_ruleId_workDescriptionId: { projectId, ruleId: r.id, workDescriptionId: wd.id } },
        create: {
          projectId,
          ruleId: r.id,
          workDescriptionId: wd.id,
          status: 'TO_CONFIRM',
          reasoning: r.relevance ? `Correspondance contextuelle: ${r.relevance}` : 'Applicable au contexte bâtiment',
          confidence,
        },
        update: {},
      });
    }

    await this.prisma.activityLog.create({
      data: {
        projectId,
        userId,
        action: `Pré-contrôle lancé (${ranked.length} règle(s) évaluée(s))`,
        entityType: 'WorkDescription',
        entityId: wd.id,
        metadata: { aiConfigured: this.ai.isConfigured(), aiModel, aiConfidence },
      },
    });

    return {
      workDescriptionId: wd.id,
      project: { buildingType: project.buildingType, erpType: project.erpType },
      aiConfigured: this.ai.isConfigured(),
      aiModel,
      aiConfidence,
      structuredContext: structured,
      rules: ranked,
    };
  }

  async materialize(workDescriptionId: string, ruleIds: string[], organizationId: string, userId: string) {
    const wd = await this.prisma.workDescription.findFirst({
      where: { id: workDescriptionId, project: { organizationId } },
      include: { project: { include: { organization: true, lots: { include: { lot: true, company: true } } } } },
    });
    if (!wd) throw new NotFoundException('Pre-check not found');

    const uniqueRuleIds = [...new Set(ruleIds)];
    const checks = await this.prisma.complianceCheck.findMany({
      where: { workDescriptionId, ruleId: { in: uniqueRuleIds }, projectId: wd.projectId },
      include: { rule: { include: { lot: true, source: true } } },
    });
    if (!checks.length) throw new BadRequestException('No matching pre-check rules were found');

    const dueDays = Math.max(1, wd.project.organization.reminderDays || 7);
    const dueDate = new Date(Date.now() + dueDays * 86400000);
    let observationsCreated = 0;
    let draftsCreated = 0;
    let needsRecipient = 0;
    const observationIds: string[] = [];

    for (const check of checks) {
      const r = check.rule;
      const projectLot = r.lotId ? wd.project.lots.find(pl => pl.lotId === r.lotId) : undefined;
      const company = projectLot?.company || null;
      const recipient = projectLot?.contactEmail || company?.email || null;
      const status = recipient ? 'TO_SEND' : 'OPEN';

      const existing = await this.prisma.observation.findFirst({
        where: {
          projectId: wd.projectId,
          title: r.title,
          reference: r.source?.reference || null,
          description: r.requirement,
          reportId: null,
        },
      });
      if (existing) {
        observationIds.push(existing.id);
        continue;
      }

      const observation = await this.prisma.observation.create({
        data: {
          projectId: wd.projectId,
          lotId: r.lotId || null,
          companyId: company?.id || null,
          title: r.title,
          description: r.requirement,
          reference: r.source?.reference || null,
          requiredAction: r.actionRequest || r.controlPoint || null,
          severity: r.severity,
          status,
          dueDate,
          aiConfidence: check.confidence,
        },
      });
      observationsCreated++;
      observationIds.push(observation.id);

      await this.prisma.observationHistory.create({
        data: { observationId: observation.id, toStatus: observation.status, note: 'Action créée depuis le pré-contrôle' },
      });

      const body = this.buildActionEmail({
        projectName: wd.project.name,
        lotName: r.lot?.name,
        title: r.title,
        description: r.requirement,
        reference: r.source?.reference || undefined,
        requiredAction: r.actionRequest || r.controlPoint || undefined,
        dueDate,
      });
      await this.prisma.generatedEmail.create({
        data: {
          projectId: wd.projectId,
          observationId: observation.id,
          recipientEmail: recipient,
          dueDate,
          subject: `[SOWEN] Action requise - ${wd.project.name} - ${r.title}`,
          body,
          status: recipient ? 'DRAFT' : 'NEEDS_RECIPIENT',
        },
      });
      if (recipient) draftsCreated++; else needsRecipient++;

      await this.prisma.complianceCheck.update({
        where: { id: check.id },
        data: { reasoning: `${check.reasoning || ''}${check.reasoning ? ' · ' : ''}Action entreprise créée` },
      });
    }

    await this.prisma.activityLog.create({
      data: {
        projectId: wd.projectId,
        userId,
        action: `Pré-contrôle converti en ${observationsCreated} action(s) entreprise`,
        entityType: 'WorkDescription',
        entityId: workDescriptionId,
        metadata: { draftsCreated, needsRecipient, observationIds },
      },
    });

    return { observationsCreated, draftsCreated, needsRecipient, observationIds, dueDate };
  }

  private buildActionEmail(input: { projectName: string; lotName?: string | null; title: string; description: string; reference?: string; requiredAction?: string; dueDate: Date }) {
    return [
      'Bonjour,',
      '',
      `Projet : ${input.projectName}`,
      `Lot : ${input.lotName || 'À préciser'}`,
      `Échéance : ${input.dueDate.toLocaleDateString('fr-FR')}`,
      '',
      `Point à traiter : ${input.title}`,
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
}
