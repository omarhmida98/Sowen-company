// Observation protection, editing and AI review tests. Run with: npm --workspace back test
// No database, AI or email provider is needed: Prisma, the analysis and the mailer are replaced by in-memory fakes.
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeChanges, diffObservation, findingKey, protectionReasons } from '../src/observations/observation-rules';
import { ObservationsService } from '../src/observations/observations.service';
import { ObservationsController } from '../src/observations/observations.controller';
import { ReportsService } from '../src/reports/reports.service';
import { ReportsController } from '../src/reports/reports.controller';
import { EmailsService } from '../src/emails/emails.service';
import { ROLES_KEY } from '../src/auth/decorators/roles.decorator';
import { describeFailure, failureKind } from '../src/reports/report-failure';

// ---------- in-memory database ----------

type Row = Record<string, any>;
const ORG = 'org-1', OTHER_ORG = 'org-2', USER = 'user-1', PROJECT = 'project-1', REPORT = 'report-1';

function database(seed: { observations?: Row[]; emails?: Row[]; history?: Row[]; evidence?: Row[]; activity?: Row[]; report?: Row } = {}) {
  let n = 0;
  const db = {
    projects: [{ id: PROJECT, name: 'Résidence Test', organizationId: ORG, organization: { reminderDays: 7 }, lots: [] }] as Row[],
    reports: [{ id: REPORT, projectId: PROJECT, rawText: 'Texte du rapport', analysisStatus: 'COMPLETED', analysisError: null, observationCount: 0, ...seed.report }] as Row[],
    companies: [{ id: 'company-1', name: 'ACME', email: 'acme@example.com', organizationId: ORG }, { id: 'company-2', name: 'Bâti Sud', email: 'bati@example.com', organizationId: ORG }, { id: 'company-x', name: 'Étrangère', email: 'x@example.com', organizationId: OTHER_ORG }] as Row[],
    lots: [{ id: 'lot-1', name: 'Électricité' }, { id: 'lot-2', name: 'Plomberie' }] as Row[],
    observations: (seed.observations || []) as Row[],
    emails: (seed.emails || []) as Row[],
    history: (seed.history || []) as Row[],
    evidence: (seed.evidence || []) as Row[],
    activity: (seed.activity || []) as Row[],
  };
  const project = (id: string) => db.projects.find(p => p.id === id)!;
  const inList = (filter: any, value: any) => (filter && typeof filter === 'object' && Array.isArray(filter.in) ? filter.in.includes(value) : filter === value);
  // What the services read: the row plus its relations. Cloned, so a service cannot change the database by accident.
  const full = (o: Row) => structuredClone({
    ...o,
    project: project(o.projectId),
    company: db.companies.find(c => c.id === o.companyId) || null,
    lot: db.lots.find(l => l.id === o.lotId) || null,
    generatedEmails: db.emails.filter(e => e.observationId === o.id),
    history: db.history.filter(h => h.observationId === o.id),
    _count: { evidence: db.evidence.filter(e => e.observationId === o.id).length, history: db.history.filter(h => h.observationId === o.id).length, assignments: 0 },
  });
  const prisma = {
    observation: {
      findFirst: async ({ where }: any) => { const o = db.observations.find(x => x.id === where.id && (!where.project || project(x.projectId).organizationId === where.project.organizationId)); return o ? full(o) : null; },
      findUnique: async ({ where }: any) => { const o = db.observations.find(x => x.id === where.id); return o ? full(o) : null; },
      findMany: async ({ where }: any) => db.observations.filter(x => !where?.reportId || x.reportId === where.reportId).map(full),
      create: async ({ data }: any) => { const row = { id: `obs-new-${++n}`, status: 'OPEN', editedAt: null, reviewStatus: null, createdAt: new Date(), ...data }; db.observations.push(row); return full(row); },
      update: async ({ where, data }: any) => { const row = db.observations.find(x => x.id === where.id)!; Object.assign(row, data); return full(row); },
      deleteMany: async ({ where }: any) => { const before = db.observations.length; db.observations = db.observations.filter(x => !inList(where.id, x.id)); db.history = db.history.filter(h => db.observations.some(o => o.id === h.observationId)); return { count: before - db.observations.length }; },
    },
    observationHistory: { create: async ({ data }: any) => { const row = { id: `h-${++n}`, createdAt: new Date(), ...data }; db.history.push(row); return row; } },
    generatedEmail: {
      findFirst: async ({ where }: any) => structuredClone(db.emails.find(e => e.observationId === where.observationId && (where.sentAt !== null || !e.sentAt) && (!where.status || inList(where.status, e.status))) || null),
      findUnique: async ({ where }: any) => { const e = db.emails.find(x => x.id === where.id); return e ? structuredClone({ ...e, project: { organizationId: project(e.projectId).organizationId } }) : null; },
      findMany: async ({ where }: any) => db.emails.filter(e => (!where.status || e.status === where.status) && project(e.projectId).organizationId === where.project.organizationId).map(e => structuredClone({ ...e, observation: db.observations.find(o => o.id === e.observationId) || null })),
      create: async ({ data }: any) => { const row = { id: `mail-new-${++n}`, sentAt: null, reminderCount: 0, ...data }; db.emails.push(row); return row; },
      delete: async ({ where }: any) => { db.emails = db.emails.filter(e => e.id !== where.id); },
      deleteMany: async ({ where }: any) => { const before = db.emails.length; db.emails = db.emails.filter(e => !(inList(where.observationId, e.observationId) && (where.sentAt !== null || !e.sentAt))); return { count: before - db.emails.length }; },
      updateMany: async () => ({ count: 0 }),
    },
    activityLog: {
      create: async ({ data }: any) => { db.activity.push({ id: `a-${++n}`, ...data }); },
      findFirst: async ({ where }: any) => db.activity.find(a => a.entityType === where.entityType && a.entityId === where.entityId && a.action.startsWith(where.action.startsWith)) || null,
      findMany: async ({ where }: any) => db.activity.filter(a => a.entityType === where.entityType && inList(where.entityId, a.entityId) && a.action.startsWith(where.action.startsWith)),
    },
    company: {
      findUnique: async ({ where }: any) => db.companies.find(c => c.id === where.id) || null,
      findMany: async ({ where }: any) => db.companies.filter(c => where.id.in.includes(c.id)),
      findFirst: async () => null,
    },
    lot: { findUnique: async ({ where }: any) => db.lots.find(l => l.id === where.id) || null, findMany: async ({ where }: any) => db.lots.filter(l => where.id.in.includes(l.id)), findFirst: async () => null },
    projectLot: { findUnique: async () => null },
    project: { findUnique: async ({ where }: any) => structuredClone(project(where.id) || null) },
    controlReport: {
      findFirst: async ({ where }: any) => { const r = db.reports.find(x => x.id === where.id && project(x.projectId).organizationId === where.project.organizationId); return r ? structuredClone(r) : null; },
      update: async ({ where, data }: any) => Object.assign(db.reports.find(x => x.id === where.id)!, data),
    },
  };
  return { db, prisma: prisma as any };
}

// An observation extracted by the AI that nobody has touched: one creation entry in its history, an automatic draft.
const aiObservation = (id: string, title: string, extra: Row = {}): Row => ({ id, projectId: PROJECT, reportId: REPORT, title, description: `${title} — détail`, reference: null, requiredAction: null, severity: 'MEDIUM', dueDate: null, lotId: null, companyId: 'company-1', status: 'OPEN', reviewStatus: 'PENDING', editedAt: null, ...extra });
const created = (observationId: string): Row => ({ id: `h-${observationId}`, observationId, toStatus: 'OPEN', note: 'Observation créée automatiquement depuis le rapport BC' });
const draft = (observationId: string, extra: Row = {}): Row => ({ id: `mail-${observationId}`, projectId: PROJECT, observationId, recipientEmail: 'acme@example.com', subject: 'Observation', body: 'Texte', status: 'DRAFT', sentAt: null, reminderCount: 0, ...extra });
const sent = (observationId: string, extra: Row = {}): Row => draft(observationId, { status: 'SENT', sentAt: new Date(), ...extra });

const finding = (title: string) => ({ title, description: `${title} — nouvelle analyse`, severity: 'HIGH', confidence: 0.6 });
// The AI is never called: the analysis result is supplied by the test.
function reportsService(prisma: any, findings: ReturnType<typeof finding>[] | Error) {
  const ai = { isConfigured: () => true, provider: () => 'Claude' };
  const service = new ReportsService(prisma, ai as any, {} as any);
  (service as any).analyzeText = async () => { if (findings instanceof Error) throw findings; return { model: 'test-model', result: { observations: findings, confidence: 0.8, documentType: 'Rapport', summary: 'Résumé' } }; };
  (service as any).logger = { log() {}, error() {}, warn() {} };
  return service;
}
const base = { status: 'OPEN', editedAt: null, reviewStatus: 'PENDING', generatedEmails: [], evidenceCount: 0, historyCount: 1, assignmentCount: 0 };

// ---------- rule: what protects an observation ----------

test('an AI observation nobody touched is not protected', () => {
  assert.deepEqual(protectionReasons(base), []);
  assert.deepEqual(protectionReasons({ ...base, status: 'TO_SEND', generatedEmails: [{ status: 'DRAFT', sentAt: null, reminderCount: 0 }] }), [], 'an automatic unsent draft is not history');
});

test('each kind of downstream history protects the observation', () => {
  assert.deepEqual(protectionReasons({ ...base, generatedEmails: [{ status: 'SENT', sentAt: new Date(), reminderCount: 0 }] }), ['SENT_EMAIL']);
  assert.deepEqual(protectionReasons({ ...base, generatedEmails: [{ status: 'SENT', sentAt: new Date(), reminderCount: 2 }] }), ['SENT_EMAIL', 'REMINDER']);
  assert.deepEqual(protectionReasons({ ...base, evidenceCount: 1 }), ['EVIDENCE'], 'evidence or company response');
  assert.deepEqual(protectionReasons({ ...base, historyCount: 2 }), ['HISTORY']);
  assert.deepEqual(protectionReasons({ ...base, status: 'WAITING' }), ['HISTORY'], 'a status beyond the initial ones');
  assert.deepEqual(protectionReasons({ ...base, editedAt: new Date() }), ['EDITED']);
  assert.deepEqual(protectionReasons({ ...base, draftEdited: true }), ['EDITED'], 'a draft rewritten by a person');
  assert.deepEqual(protectionReasons({ ...base, reviewStatus: 'VALIDATED' }), ['REVIEWED']);
  assert.deepEqual(protectionReasons({ ...base, reviewStatus: 'REJECTED', status: 'RESOLVED' }), ['HISTORY', 'REVIEWED']);
  assert.deepEqual(protectionReasons({ ...base, assignmentCount: 1 }), ['ASSIGNED']);
});

test('a send that failed does not count as a sent email', () => {
  assert.deepEqual(protectionReasons({ ...base, generatedEmails: [{ status: 'ERROR', sentAt: null, reminderCount: 0 }] }), []);
});

test('the same finding is recognised whatever the case, accents or punctuation', () => {
  assert.equal(findingKey('Absence de désenfumage — cage B.'), findingKey('ABSENCE DE DESENFUMAGE (cage B)'));
  assert.notEqual(findingKey('Absence de désenfumage'), findingKey('Absence de détection incendie'));
});

// ---------- re-analysis never destroys history ----------

test('re-analysis cannot destroy an observation with a sent email', async () => {
  const { db, prisma } = database({ observations: [aiObservation('obs-sent', 'Absence de désenfumage', { status: 'SENT' })], emails: [sent('obs-sent', { reminderCount: 1 })], history: [created('obs-sent')] });
  const result: any = await reportsService(prisma, [finding('Câblage non conforme')]).reanalyze(REPORT, ORG, USER, { replaceUnprotected: true });

  const kept = db.observations.find(o => o.id === 'obs-sent')!;
  assert.ok(kept, 'the sent observation still exists');
  assert.equal(kept.title, 'Absence de désenfumage', 'and is not overwritten');
  assert.equal(kept.status, 'SENT');
  assert.equal(db.emails.filter(e => e.observationId === 'obs-sent' && e.sentAt).length, 1, 'its sent email and reminder count are kept');
  assert.equal(db.emails.find(e => e.observationId === 'obs-sent')!.reminderCount, 1);
  assert.equal(result.keptObservations, 1);
  assert.equal(result.replacedObservations, 0);
  assert.equal(result.createdObservations, 1, 'the new finding is added');
  assert.equal(db.reports[0].observationCount, 2);
});

test('re-analysis cannot destroy evidence, a company response or follow-up history', async () => {
  const { db, prisma } = database({
    observations: [aiObservation('obs-evidence', 'Justificatif reçu'), aiObservation('obs-history', 'Suivi en cours', { status: 'WAITING' }), aiObservation('obs-edited', 'Corrigée à la main', { editedAt: new Date() })],
    evidence: [{ id: 'ev-1', observationId: 'obs-evidence', submittedByCompany: true }],
    history: [created('obs-evidence'), created('obs-history'), { id: 'h-2', observationId: 'obs-history', fromStatus: 'SENT', toStatus: 'WAITING', note: 'Réponse de l’entreprise' }, created('obs-edited')],
  });
  const service = reportsService(prisma, []);
  const plan = await service.reanalysisPlan(REPORT, ORG);
  assert.equal(plan.protectedCount, 3);
  assert.equal(plan.replaceableCount, 0);
  assert.deepEqual(plan.items.map(i => i.reasons), [['EVIDENCE'], ['HISTORY'], ['EDITED']]);

  // Even when replacement is explicitly requested, and even when the new analysis finds nothing.
  await service.reanalyze(REPORT, ORG, USER, { replaceUnprotected: true });
  assert.deepEqual(db.observations.map(o => o.id), ['obs-evidence', 'obs-history', 'obs-edited']);
  assert.equal(db.evidence.length, 1);
  assert.equal(db.history.filter(h => h.observationId === 'obs-history').length, 2, 'history entries are kept');
  assert.equal(db.reports[0].observationCount, 3);
});

test('a draft rewritten by a person protects its observation', async () => {
  const { prisma } = database({ observations: [aiObservation('obs-1', 'Point A')], emails: [draft('obs-1')], history: [created('obs-1')], activity: [{ entityType: 'GeneratedEmail', entityId: 'mail-obs-1', action: 'Brouillon de mail enregistré' }] });
  const plan = await reportsService(prisma, []).reanalysisPlan(REPORT, ORG);
  assert.deepEqual(plan.items[0].reasons, ['EDITED']);
});

test('an untouched AI observation is not replaced without an explicit confirmation', async () => {
  const { db, prisma } = database({ observations: [aiObservation('obs-old', 'Ancien point')], emails: [draft('obs-old')], history: [created('obs-old')] });
  const service = reportsService(prisma, [finding('Nouveau point')]);
  await assert.rejects(() => service.reanalyze(REPORT, ORG, USER), (e: any) => e.status === 409 && /Confirmez le remplacement/.test(e.message));
  assert.deepEqual(db.observations.map(o => o.id), ['obs-old'], 'nothing was deleted');
  assert.equal(db.emails.length, 1);
  assert.equal(db.reports[0].analysisStatus, 'COMPLETED', 'the report is untouched');
});

test('with confirmation, untouched AI observations are replaced and protected ones are kept', async () => {
  const { db, prisma } = database({
    observations: [aiObservation('obs-old', 'Ancien point'), aiObservation('obs-sent', 'Absence de désenfumage', { status: 'SENT', reviewStatus: 'VALIDATED' })],
    emails: [draft('obs-old'), sent('obs-sent')], history: [created('obs-old'), created('obs-sent')],
  });
  // The new analysis returns the protected finding again (worded differently) and a new one.
  const result: any = await reportsService(prisma, [finding('ABSENCE DE DESENFUMAGE'), finding('Nouveau point')]).reanalyze(REPORT, ORG, USER, { replaceUnprotected: true });

  assert.equal(db.observations.some(o => o.id === 'obs-old'), false, 'the untouched observation is replaced');
  assert.equal(db.emails.some(e => e.observationId === 'obs-old'), false, 'with its unsent draft');
  assert.equal(db.observations.filter(o => findingKey(o.title) === findingKey('Absence de désenfumage')).length, 1, 'the protected finding is not duplicated');
  assert.equal(db.observations.find(o => o.id === 'obs-sent')!.description, 'Absence de désenfumage — détail', 'nor overwritten');
  const added = db.observations.find(o => o.title === 'Nouveau point')!;
  assert.equal(added.reviewStatus, 'PENDING', 'new AI observations wait for review');
  assert.equal(added.reportId, REPORT);
  assert.deepEqual({ created: result.createdObservations, kept: result.keptObservations, replaced: result.replacedObservations, alreadyPresent: result.alreadyPresent }, { created: 1, kept: 1, replaced: 1, alreadyPresent: 1 });
});

test('when the new analysis fails nothing is deleted and the report keeps its status', async () => {
  const { db, prisma } = database({ observations: [aiObservation('obs-old', 'Ancien point')], emails: [draft('obs-old')], history: [created('obs-old')] });
  const result: any = await reportsService(prisma, new Error('Service IA indisponible (503)')).reanalyze(REPORT, ORG, USER, { replaceUnprotected: true });
  assert.equal(result.analysisStatus, 'FAILED');
  assert.deepEqual(db.observations.map(o => o.id), ['obs-old']);
  assert.equal(db.emails.length, 1);
  assert.equal(db.reports[0].analysisStatus, 'COMPLETED');
  assert.match(db.reports[0].analysisError, /503/);
});

test('a report from another organisation cannot be re-analysed or inspected', async () => {
  const { db, prisma } = database({ observations: [aiObservation('obs-old', 'Ancien point')], history: [created('obs-old')] });
  const service = reportsService(prisma, []);
  await assert.rejects(() => service.reanalyze(REPORT, OTHER_ORG, USER, { replaceUnprotected: true }), (e: any) => e.status === 404);
  await assert.rejects(() => service.reanalysisPlan(REPORT, OTHER_ORG), (e: any) => e.status === 404);
  assert.equal(db.observations.length, 1);
});

// ---------- editing ----------

const roles = (controller: any, method: string) => Reflect.getMetadata(ROLES_KEY, controller.prototype[method]);

test('only administrators and editors may edit, review or re-analyse; a consultant (USER) cannot', () => {
  for (const method of ['update', 'review', 'transition']) assert.deepEqual(roles(ObservationsController, method), ['ADMIN', 'EDITOR'], method);
  for (const method of ['reanalyze', 'reanalysisPlan']) assert.deepEqual(roles(ReportsController, method), ['ADMIN', 'EDITOR'], method);
  assert.equal(roles(ObservationsController, 'update').includes('USER'), false);
});

test('an edit changes the fields and records what changed in the history and the activity log', async () => {
  const { db, prisma } = database({ observations: [aiObservation('obs-1', 'Titre initial', { lotId: 'lot-1' })], history: [created('obs-1')] });
  await new ObservationsService(prisma).update('obs-1', { title: 'Titre corrigé', severity: 'CRITICAL', dueDate: '2026-11-15', companyId: 'company-2', lotId: 'lot-2', reference: 'CO 34', requiredAction: 'Installer un exutoire', description: 'Nouvelle description' } as any, ORG, USER);

  const o = db.observations[0];
  assert.equal(o.title, 'Titre corrigé');
  assert.equal(o.severity, 'CRITICAL');
  assert.equal(o.companyId, 'company-2');
  assert.equal(o.lotId, 'lot-2');
  assert.equal(o.reference, 'CO 34');
  assert.equal(o.dueDate.toISOString().slice(0, 10), '2026-11-15');
  assert.ok(o.editedAt instanceof Date, 'marked as edited by a person');

  const entry = db.history.at(-1)!;
  assert.equal(entry.fromStatus, entry.toStatus, 'an edit is not a status change');
  for (const expected of ['Titre « Titre initial » → « Titre corrigé »', 'Sévérité « Moyenne » → « Critique »', 'Entreprise « ACME » → « Bâti Sud »', 'Lot « Électricité » → « Plomberie »', 'Échéance « — » → « 2026-11-15 »', 'Référence', 'Action attendue', 'Description']) assert.ok(entry.note.includes(expected), `history mentions: ${expected}`);
  const log = db.activity.find(a => a.action === 'Observation modifiée')!;
  assert.equal(log.userId, USER);
  assert.deepEqual(log.metadata.changes.map((c: any) => c.field).sort(), ['companyId', 'description', 'dueDate', 'lotId', 'reference', 'requiredAction', 'severity', 'title']);
});

test('saving without changing anything writes no history', async () => {
  const { db, prisma } = database({ observations: [aiObservation('obs-1', 'Titre')], history: [created('obs-1')] });
  await new ObservationsService(prisma).update('obs-1', { title: 'Titre', severity: 'MEDIUM', reference: null } as any, ORG, USER);
  assert.equal(db.history.length, 1);
  assert.equal(db.observations[0].editedAt, null);
  assert.equal(db.activity.length, 0);
});

test('an edit never touches the status, the sent emails or the earlier history', async () => {
  const { db, prisma } = database({ observations: [aiObservation('obs-1', 'Titre', { status: 'SENT', reviewStatus: 'VALIDATED' })], emails: [sent('obs-1')], history: [created('obs-1')] });
  await new ObservationsService(prisma).update('obs-1', { title: 'Titre précisé' } as any, ORG, USER);
  assert.equal(db.observations[0].status, 'SENT');
  assert.equal(db.emails.length, 1);
  assert.ok(db.emails[0].sentAt);
  assert.equal(db.history.length, 2, 'the creation entry is still there, plus the edit');
});

test('an edit rebuilds an automatic draft but keeps a draft a person saved', async () => {
  const auto = database({ observations: [aiObservation('obs-1', 'Titre')], emails: [draft('obs-1')], history: [created('obs-1')] });
  await new ObservationsService(auto.prisma).update('obs-1', { title: 'Titre corrigé' } as any, ORG, USER);
  assert.equal(auto.db.emails.length, 1);
  assert.equal(auto.db.emails[0].subject, '[SOWEN] Titre corrigé');

  const saved = database({ observations: [aiObservation('obs-1', 'Titre')], emails: [draft('obs-1', { body: 'Texte rédigé à la main' })], history: [created('obs-1')], activity: [{ entityType: 'GeneratedEmail', entityId: 'mail-obs-1', action: 'Brouillon de mail enregistré' }] });
  await new ObservationsService(saved.prisma).update('obs-1', { title: 'Titre corrigé' } as any, ORG, USER);
  assert.equal(saved.db.emails[0].body, 'Texte rédigé à la main');
});

test('editing an observation of another organisation is refused and changes nothing', async () => {
  const { db, prisma } = database({ observations: [aiObservation('obs-1', 'Titre')], history: [created('obs-1')] });
  const service = new ObservationsService(prisma);
  await assert.rejects(() => service.update('obs-1', { title: 'Piraté' } as any, OTHER_ORG, 'intruder'), (e: any) => e.status === 404);
  await assert.rejects(() => service.review('obs-1', { decision: 'REJECTED' } as any, OTHER_ORG, 'intruder'), (e: any) => e.status === 404);
  assert.equal(db.observations[0].title, 'Titre');
  assert.equal(db.observations[0].reviewStatus, 'PENDING');
  assert.equal(db.history.length, 1);
});

test('an observation cannot be assigned to a company of another organisation', async () => {
  const { db, prisma } = database({ observations: [aiObservation('obs-1', 'Titre')], history: [created('obs-1')] });
  await assert.rejects(() => new ObservationsService(prisma).update('obs-1', { companyId: 'company-x' } as any, ORG, USER), (e: any) => e.status === 403);
  assert.equal(db.observations[0].companyId, 'company-1');
});

test('the title and the description cannot be emptied', async () => {
  const { prisma } = database({ observations: [aiObservation('obs-1', 'Titre')], history: [created('obs-1')] });
  await assert.rejects(() => new ObservationsService(prisma).update('obs-1', { title: '   ' } as any, ORG, USER), (e: any) => e.status === 400);
});

test('diff: only real changes are reported, and long values are shortened in the history line', () => {
  const current = { title: 'A', description: 'D', reference: null, requiredAction: null, severity: 'LOW', dueDate: new Date('2026-10-10T00:00:00Z'), lotId: null, companyId: null };
  assert.deepEqual(diffObservation(current, { title: ' A ', reference: '', dueDate: new Date('2026-10-10T08:00:00Z') }), [], 'whitespace, empty-vs-null and same day are not changes');
  const changes = diffObservation(current, { description: 'x'.repeat(200), dueDate: null });
  assert.deepEqual(changes.map(c => c.field), ['description', 'dueDate']);
  assert.ok(describeChanges(changes).length < 200);
  assert.ok(describeChanges(changes).startsWith('Modification : Description « D » → «'));
});

// ---------- AI review ----------

test('a rejected AI observation is closed, loses its unsent draft and cannot be sent', async () => {
  const { db, prisma } = database({ observations: [aiObservation('obs-1', 'Faux positif')], emails: [draft('obs-1')], history: [created('obs-1')] });
  const observations = new ObservationsService(prisma);
  await observations.review('obs-1', { decision: 'REJECTED', note: 'Hors périmètre' } as any, ORG, USER);
  assert.equal(db.observations[0].reviewStatus, 'REJECTED');
  assert.equal(db.observations[0].status, 'RESOLVED');
  assert.equal(db.observations[0].reviewedById, USER);
  assert.equal(db.emails.length, 0, 'the unsent draft is removed');
  assert.match(db.history.at(-1)!.note, /Observation IA rejetée : Hors périmètre/);

  // No route sends it: a status change, a draft created behind the service's back, or the bulk send.
  await assert.rejects(() => observations.transition('obs-1', { status: 'OPEN' } as any, ORG, USER), (e: any) => e.status === 400 && /rejetée/.test(e.message));
  db.emails.push(draft('obs-1'));
  let delivered = 0;
  const mailer = { isConfigured: () => true, send: async () => { delivered++; return { id: 'x' }; } };
  const emails = new EmailsService(prisma, mailer as any);
  await assert.rejects(() => emails.send('mail-obs-1', ORG, USER), (e: any) => e.status === 400 && /rejetée/.test(e.message));
  const bulk = await emails.sendDrafts(ORG, USER);
  assert.deepEqual({ total: bulk.total, skipped: bulk.skippedForReview }, { total: 0, skipped: 1 });
  assert.equal(delivered, 0, 'nothing reached the email provider');
});

test('an observation already sent to a company cannot be rejected', async () => {
  const { db, prisma } = database({ observations: [aiObservation('obs-1', 'Envoyée', { status: 'SENT', reviewStatus: 'VALIDATED' })], emails: [sent('obs-1')], history: [created('obs-1')] });
  await assert.rejects(() => new ObservationsService(prisma).review('obs-1', { decision: 'REJECTED' } as any, ORG, USER), (e: any) => e.status === 400 && /déjà été envoyée/.test(e.message));
  assert.equal(db.observations[0].status, 'SENT');
  assert.equal(db.emails.length, 1);
});

test('a validated AI observation continues through the normal workflow', async () => {
  const { db, prisma } = database({ observations: [aiObservation('obs-1', 'Point réel')], emails: [draft('obs-1')], history: [created('obs-1')] });
  const observations = new ObservationsService(prisma);
  await observations.review('obs-1', { decision: 'VALIDATED' } as any, ORG, USER);
  assert.equal(db.observations[0].reviewStatus, 'VALIDATED');
  assert.equal(db.observations[0].status, 'OPEN', 'validation does not change the status');
  assert.equal(db.emails.length, 1, 'the draft is kept');
  assert.match(db.history.at(-1)!.note, /Observation IA validée/);

  await observations.transition('obs-1', { status: 'TO_SEND' } as any, ORG, USER);
  assert.equal(db.observations[0].status, 'TO_SEND');

  // The bulk send takes validated and manual observations, and leaves the ones still to review.
  db.observations.push(aiObservation('obs-pending', 'À relire'), aiObservation('obs-manual', 'Manuelle', { reportId: null, reviewStatus: null }));
  db.emails.push(draft('obs-pending'), draft('obs-manual'));
  const emails = new EmailsService(prisma, { isConfigured: () => true } as any);
  const taken: string[] = [];
  (emails as any).send = async (id: string) => { taken.push(id); };
  const bulk = await emails.sendDrafts(ORG, USER);
  assert.deepEqual(taken.sort(), ['mail-obs-1', 'mail-obs-manual']);
  assert.equal(bulk.skippedForReview, 1);
});

test('a rejected observation can be restored: it is reopened, to review again, with a new draft', async () => {
  const { db, prisma } = database({ observations: [aiObservation('obs-1', 'Rejetée par erreur', { reviewStatus: 'REJECTED', status: 'RESOLVED' })], history: [created('obs-1')] });
  await new ObservationsService(prisma).review('obs-1', { decision: 'PENDING' } as any, ORG, USER);
  assert.equal(db.observations[0].reviewStatus, 'PENDING');
  assert.equal(db.observations[0].status, 'OPEN');
  assert.equal(db.emails.length, 1);
});

test('manual observations have no AI review and keep working as before', async () => {
  const { db, prisma } = database({ observations: [aiObservation('obs-1', 'Manuelle', { reportId: null, reviewStatus: null })], history: [created('obs-1')] });
  const observations = new ObservationsService(prisma);
  await assert.rejects(() => observations.review('obs-1', { decision: 'REJECTED' } as any, ORG, USER), (e: any) => e.status === 400);
  await observations.transition('obs-1', { status: 'TO_SEND' } as any, ORG, USER);
  assert.equal(db.observations[0].status, 'TO_SEND');
  assert.equal(db.observations[0].reviewStatus, null);
});

// ---------- failed reports ----------

test('a failed analysis is explained and is retryable only when a retry can work', () => {
  const gemini = '{"error":{"code":503,"message":"This model is currently experiencing high demand. Please try again later.","status":"UNAVAILABLE"}}';
  assert.deepEqual({ ...describeFailure(gemini, true, true), message: undefined, retryHint: undefined }, { kind: 'AI_UNAVAILABLE', retryable: true, message: undefined, retryHint: undefined });
  assert.equal(describeFailure(gemini, true, false).retryable, false, 'no AI configured: nothing to retry with');
  assert.equal(failureKind('Aucun texte exploitable dans ce PDF', false), 'NO_TEXT');
  assert.equal(describeFailure('whatever', false, true).retryable, false, 'no extracted text: a retry cannot work');
  assert.equal(failureKind('Clé API Anthropic invalide ou révoquée', true), 'AI_CONFIGURATION');
  assert.equal(failureKind('Réponse IA invalide : JSON tronquée', true), 'AI_INVALID_ANSWER');
  assert.equal(failureKind('Erreur inattendue', true), 'UNKNOWN');
  assert.equal(describeFailure('Erreur inattendue', true, true).retryable, true);
  assert.ok(!describeFailure(gemini, true, true).message.includes('503'), 'the message shown is not the raw provider error');
});
