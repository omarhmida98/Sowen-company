import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { describeReasons, matchRules, termPairs, words } from '../rules/rule-matching';

// What the AI is asked for: vocabulary only. It never writes guidance, risks or references.
type Normalized = { workTypes?: string[]; keywords?: string[] };
const NORMALIZE_PROMPT = 'You normalise a French description of construction works so that it can be compared with a library of rules. Return strict JSON {"workTypes": string[], "keywords": string[]}. workTypes: the kinds of works described, in standard French trade vocabulary. keywords: technical terms of the description and their usual synonyms (equipment, materials, building parts, trades). Only terms that are in the description or are direct synonyms of them. At most 12 items in each list, lowercase, one to three words each. Do not give advice, risks, instructions, requirements, standards or regulatory references.';
const cleanTerms = (list: unknown) => (Array.isArray(list) ? list : []).filter((x): x is string => typeof x === 'string').map(x => x.trim().slice(0, 60)).filter(Boolean).slice(0, 12);

@Injectable()
export class ComplianceService {
  constructor(private prisma: PrismaService, private ai: AiService) {}

  // Compares a description of planned works with the active rules of the organisation's library.
  // The result only contains rules of that library, each with the reason it matched. When nothing matches the list
  // is empty: no guidance is made up.
  async precheck(projectId: string, rawText: string, lotId: string | undefined, organizationId: string, userId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.organizationId !== organizationId) throw new ForbiddenException('Project does not belong to your organization');
    const description = String(rawText || '').trim();
    if (!description) throw new BadRequestException('Décrivez les travaux prévus.');

    const libraryActiveRules = await this.prisma.rule.count({ where: { organizationId, active: true } });
    // Without rules there is nothing to compare with: say so instead of running an empty analysis.
    if (!libraryActiveRules) return { emptyLibrary: true, libraryActiveRules: 0, evaluatedRules: 0, workDescriptionId: null, aiUsed: false, terms: { fromText: words(description), fromAi: [] as string[] }, matches: [] };

    let normalized: Normalized | null = null;
    let aiModel: string | null = null;
    if (this.ai.isConfigured()) {
      try {
        const result = await this.ai.json<Normalized>(NORMALIZE_PROMPT, `Description des travaux : ${description}`);
        normalized = { workTypes: cleanTerms(result.data?.workTypes), keywords: cleanTerms(result.data?.keywords) };
        aiModel = result.model;
      } catch {
        normalized = null; // the comparison still runs on the words of the description
      }
    }
    const aiTerms = normalized ? [...(normalized.workTypes || []), ...(normalized.keywords || [])] : [];

    const rules = await this.prisma.rule.findMany({ where: { organizationId, active: true }, include: { lot: { select: { id: true, name: true } } } });
    const matches = matchRules(rules, { description, aiTerms, lotId: lotId || null, buildingType: project.buildingType, erpType: project.erpType });

    const wd = await this.prisma.workDescription.create({ data: { projectId, rawText: description, structuredContext: normalized || undefined, aiModel } });
    for (const m of matches) {
      await this.prisma.complianceCheck.create({ data: { projectId, ruleId: m.rule.id, workDescriptionId: wd.id, status: 'TO_CONFIRM', reasoning: describeReasons(m.reasons, m.rule.lot?.name) } });
    }
    await this.prisma.activityLog.create({ data: { projectId, userId, action: `Pré-contrôle lancé (${matches.length} règle(s) correspondante(s) sur ${rules.length})`, entityType: 'WorkDescription', entityId: wd.id, metadata: { aiUsed: Boolean(normalized), aiModel } } });

    return {
      emptyLibrary: false,
      libraryActiveRules,
      evaluatedRules: rules.length,
      workDescriptionId: wd.id,
      aiUsed: Boolean(normalized),
      // the vocabulary the comparison used; AI terms are listed apart so that their origin is visible
      terms: { fromText: words(description), fromAi: termPairs(aiTerms.join(' ')).filter(p => !termPairs(description).some(d => d.stem === p.stem)).map(p => p.word) },
      matches: matches.map(m => ({
        // every value below is read from the rule: nothing is generated
        rule: { id: m.rule.id, title: m.rule.title, domain: m.rule.domain, workType: m.rule.workType, lot: m.rule.lot, summary: m.rule.summary, requirement: m.rule.requirement, reference: m.rule.reference, sourceDocument: m.rule.sourceDocument, controlPoint: m.rule.controlPoint, actionRequest: m.rule.actionRequest, evidenceRequired: m.rule.evidenceRequired, severity: m.rule.severity },
        score: m.score,
        reasons: m.reasons,
      })),
    };
  }

  // Turns selected findings of a pre-control into observations. Each observation keeps a link to its rule, which is
  // also how duplicates are avoided: a rule that already has an open observation on the project is not converted again.
  async materialize(workDescriptionId: string, ruleIds: string[], organizationId: string, userId: string) {
    const wd = await this.prisma.workDescription.findFirst({
      where: { id: workDescriptionId, project: { organizationId } },
      include: { project: { include: { organization: true, lots: { include: { lot: true, company: true } } } } },
    });
    if (!wd) throw new NotFoundException('Pre-check not found');

    const uniqueRuleIds = [...new Set(ruleIds)];
    const checks = await this.prisma.complianceCheck.findMany({
      where: { workDescriptionId, ruleId: { in: uniqueRuleIds }, projectId: wd.projectId, rule: { organizationId } },
      include: { rule: { include: { lot: true } } },
    });
    if (!checks.length) throw new BadRequestException('No matching pre-check rules were found');

    const dueDays = Math.max(1, wd.project.organization.reminderDays || 7);
    const dueDate = new Date(Date.now() + dueDays * 86400000);
    let observationsCreated = 0, alreadyExisting = 0, draftsCreated = 0, needsRecipient = 0;
    const observationIds: string[] = [];

    for (const check of checks) {
      const r = check.rule;
      const existing = await this.prisma.observation.findFirst({ where: { projectId: wd.projectId, ruleId: r.id, status: { not: 'RESOLVED' } }, select: { id: true } });
      if (existing) { alreadyExisting++; observationIds.push(existing.id); continue; }

      const projectLot = r.lotId ? wd.project.lots.find(pl => pl.lotId === r.lotId) : undefined;
      const company = projectLot?.company || null;
      const recipient = projectLot?.contactEmail || company?.email || null;
      const requiredAction = r.actionRequest || r.controlPoint || null;
      const observation = await this.prisma.observation.create({
        data: { projectId: wd.projectId, ruleId: r.id, lotId: r.lotId || null, companyId: company?.id || null, title: r.title, description: r.requirement, reference: r.reference || null, requiredAction, severity: r.severity, status: recipient ? 'TO_SEND' : 'OPEN', dueDate },
      });
      observationsCreated++;
      observationIds.push(observation.id);
      await this.prisma.observationHistory.create({ data: { observationId: observation.id, toStatus: observation.status, note: `Action créée depuis le pré-contrôle (règle : ${r.title})` } });

      const body = this.buildActionEmail({ projectName: wd.project.name, lotName: r.lot?.name, title: r.title, description: r.requirement, reference: r.reference || undefined, requiredAction: requiredAction || undefined, dueDate });
      await this.prisma.generatedEmail.create({ data: { projectId: wd.projectId, observationId: observation.id, recipientEmail: recipient, dueDate, subject: `[SOWEN] Action requise - ${wd.project.name} - ${r.title}`, body, status: recipient ? 'DRAFT' : 'NEEDS_RECIPIENT' } });
      if (recipient) draftsCreated++; else needsRecipient++;
      await this.prisma.complianceCheck.update({ where: { id: check.id }, data: { reasoning: `${check.reasoning || ''}${check.reasoning ? ' · ' : ''}Action entreprise créée` } });
    }

    await this.prisma.activityLog.create({ data: { projectId: wd.projectId, userId, action: `Pré-contrôle converti en ${observationsCreated} action(s) entreprise`, entityType: 'WorkDescription', entityId: workDescriptionId, metadata: { draftsCreated, needsRecipient, alreadyExisting, observationIds } } });
    return { observationsCreated, alreadyExisting, draftsCreated, needsRecipient, observationIds, dueDate };
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
