import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RuleDto, UpdateRuleDto } from './rules.dto';
import { ImportPreview, MAX_IMPORT_BYTES, csvTemplate, ruleKey, validateImport } from './rule-csv';

const DUPLICATE = 'Une règle identique existe déjà dans votre bibliothèque (même titre, même lot, même référence).';
const text = (v: unknown) => { const s = typeof v === 'string' ? v.trim() : ''; return s || null; };

// The rule library of an organisation. Every method is scoped to the caller's organisation: a rule of another
// organisation is "not found". The rules are what the organisation wrote or imported; SOWEN does not check them.
@Injectable()
export class RulesService {
  constructor(private prisma: PrismaService) {}

  private readonly include = { lot: { select: { id: true, name: true } }, _count: { select: { versions: true, observations: true, complianceChecks: true } } };

  list(organizationId: string) {
    return this.prisma.rule.findMany({ where: { organizationId }, include: this.include, orderBy: [{ active: 'desc' }, { domain: 'asc' }, { title: 'asc' }] });
  }

  // What the pre-control and the empty states need to know about the library.
  async summary(organizationId: string) {
    const [total, active] = await Promise.all([this.prisma.rule.count({ where: { organizationId } }), this.prisma.rule.count({ where: { organizationId, active: true } })]);
    return { total, active, inactive: total - active };
  }

  private async owned(id: string, organizationId: string) {
    const rule = await this.prisma.rule.findFirst({ where: { id, organizationId }, include: { ...this.include, versions: { orderBy: { version: 'desc' } } } });
    if (!rule) throw new NotFoundException('Règle introuvable');
    return rule;
  }

  get(id: string, organizationId: string) { return this.owned(id, organizationId); }

  private async assertLot(lotId: string | null) {
    if (lotId && !(await this.prisma.lot.findUnique({ where: { id: lotId }, select: { id: true } }))) throw new BadRequestException('Lot introuvable');
  }

  private async assertNotDuplicate(rule: { title: string; lotId: string | null; reference: string | null }, organizationId: string, exceptId?: string) {
    const others = await this.prisma.rule.findMany({ where: { organizationId, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { title: true, lotId: true, reference: true } });
    const key = ruleKey(rule);
    if (others.some(o => ruleKey(o) === key)) throw new ConflictException(DUPLICATE);
  }

  async create(dto: RuleDto, organizationId: string, userId: string) {
    const data = {
      organizationId, title: dto.title.trim(), domain: dto.domain.trim(), lotId: text(dto.lotId), workType: text(dto.workType),
      requirement: dto.requirement.trim(), summary: text(dto.summary) || dto.requirement.trim(), reference: text(dto.reference), sourceDocument: text(dto.sourceDocument),
      severity: dto.severity || 'MEDIUM', controlPoint: text(dto.controlPoint), actionRequest: text(dto.actionRequest), evidenceRequired: text(dto.evidenceRequired),
      buildingType: dto.buildingType || null, erpType: text(dto.erpType), active: dto.active !== false,
    };
    if (!data.title || !data.domain || !data.requirement) throw new BadRequestException('Le titre, la catégorie et l’exigence sont obligatoires.');
    await this.assertLot(data.lotId);
    await this.assertNotDuplicate(data, organizationId);
    const rule = await this.prisma.rule.create({ data });
    await this.prisma.ruleVersion.create({ data: { ruleId: rule.id, version: 1, requirement: rule.requirement, actionRequest: rule.actionRequest } });
    await this.prisma.activityLog.create({ data: { userId, action: `Règle ajoutée (${rule.title})`, entityType: 'Rule', entityId: rule.id } });
    return this.owned(rule.id, organizationId);
  }

  // Only the fields present in the request change. A new requirement or preventive action is kept as a new version.
  async update(id: string, dto: UpdateRuleDto, organizationId: string, userId: string) {
    const current = await this.owned(id, organizationId);
    const data: Record<string, unknown> = {};
    for (const field of ['title', 'domain', 'requirement'] as const) if (dto[field] !== undefined) { const v = String(dto[field]).trim(); if (!v) throw new BadRequestException('Le titre, la catégorie et l’exigence ne peuvent pas être vides.'); data[field] = v; }
    for (const field of ['lotId', 'workType', 'reference', 'sourceDocument', 'controlPoint', 'actionRequest', 'evidenceRequired', 'erpType'] as const) if (dto[field] !== undefined) data[field] = text(dto[field]);
    if (dto.summary !== undefined) data.summary = text(dto.summary) || (data.requirement as string) || current.requirement;
    if (dto.severity !== undefined) data.severity = dto.severity;
    if (dto.buildingType !== undefined) data.buildingType = dto.buildingType || null;
    if (dto.active !== undefined) data.active = dto.active;
    const next = { ...current, ...data } as typeof current;
    if (data.lotId !== undefined) await this.assertLot(next.lotId);
    if (ruleKey(next) !== ruleKey(current)) await this.assertNotDuplicate(next, organizationId, id);
    await this.prisma.rule.update({ where: { id }, data });
    if (next.requirement !== current.requirement || next.actionRequest !== current.actionRequest) {
      const version = (current.versions[0]?.version || 0) + 1;
      await this.prisma.ruleVersion.create({ data: { ruleId: id, version, requirement: next.requirement, actionRequest: next.actionRequest, effectiveFrom: new Date() } });
    }
    const action = dto.active !== undefined && dto.active !== current.active && Object.keys(data).length === 1 ? (dto.active ? 'Règle activée' : 'Règle désactivée') : 'Règle modifiée';
    await this.prisma.activityLog.create({ data: { userId, action: `${action} (${next.title})`, entityType: 'Rule', entityId: id } });
    return this.owned(id, organizationId);
  }

  // A rule that pre-controls or observations refer to is part of the record: it can be deactivated, not deleted.
  async remove(id: string, organizationId: string, userId: string) {
    const rule = await this.owned(id, organizationId);
    if (rule._count.observations || rule._count.complianceChecks) throw new ConflictException('Cette règle a déjà servi à un pré-contrôle ou à une observation : elle ne peut pas être supprimée. Désactivez-la pour qu’elle ne soit plus proposée.');
    await this.prisma.rule.delete({ where: { id } });
    await this.prisma.activityLog.create({ data: { userId, action: `Règle supprimée (${rule.title})`, entityType: 'Rule', entityId: id } });
    return { deleted: true, id };
  }

  // ---------- CSV import ----------

  template() { return csvTemplate(); }

  private decode(file: Express.Multer.File | undefined) {
    if (!file?.buffer?.length) throw new BadRequestException('Fichier CSV manquant ou vide.');
    if (file.buffer.length > MAX_IMPORT_BYTES) throw new BadRequestException('Fichier trop volumineux (2 Mo au maximum).');
    const csv = file.buffer.toString('utf8');
    // A file saved in another encoding (or not a text file) shows up as replacement characters or binary bytes.
    if (csv.includes('\u0000') || (csv.match(/�/g) || []).length > 2) throw new BadRequestException('Fichier illisible : enregistrez-le au format CSV UTF-8.');
    return csv;
  }

  // Reads the file and says, line by line, what an import would do. Nothing is written.
  async preview(file: Express.Multer.File | undefined, organizationId: string): Promise<ImportPreview> {
    const csv = this.decode(file);
    const [lots, existing] = await Promise.all([this.prisma.lot.findMany({ select: { id: true, name: true, code: true } }), this.prisma.rule.findMany({ where: { organizationId }, select: { title: true, lotId: true, reference: true } })]);
    return validateImport(csv, { lots, existingKeys: new Set(existing.map(ruleKey)) });
  }

  // All or nothing: if one line is invalid nothing is imported. Lines identical to a rule already in the library,
  // or repeated in the file, are skipped and reported.
  async import(file: Express.Multer.File | undefined, organizationId: string, userId: string) {
    const preview = await this.preview(file, organizationId);
    if (preview.fileErrors.length) throw new BadRequestException(preview.fileErrors[0]);
    if (preview.summary.errors) throw new BadRequestException(`${preview.summary.errors} ligne(s) invalide(s) : rien n’a été importé. Corrigez le fichier puis relancez l’import.`);
    const valid = preview.rows.filter(r => r.status === 'OK');
    if (!valid.length) throw new BadRequestException('Aucune nouvelle règle à importer : toutes les lignes existent déjà dans votre bibliothèque.');
    const created = await this.prisma.$transaction(async tx => {
      const ids: string[] = [];
      for (const { rule: { lotName, ...data } } of valid) {
        const rule = await tx.rule.create({ data: { ...data, organizationId } });
        await tx.ruleVersion.create({ data: { ruleId: rule.id, version: 1, requirement: rule.requirement, actionRequest: rule.actionRequest } });
        ids.push(rule.id);
      }
      return ids;
    });
    await this.prisma.activityLog.create({ data: { userId, action: `Import de règles : ${created.length} règle(s) ajoutée(s)`, entityType: 'Rule', entityId: created[0], metadata: { created: created.length, duplicatesSkipped: preview.summary.duplicates, file: file?.originalname || null } } });
    return { created: created.length, duplicatesSkipped: preview.summary.duplicates, total: preview.summary.total };
  }
}
