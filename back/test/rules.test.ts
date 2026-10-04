// Rule library and preventive pre-control tests. Run with: npm --workspace back test
// No database or AI is needed: Prisma and the AI service are replaced by in-memory fakes.
// The rules used here are invented test fixtures, not regulatory content.
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RulesService } from '../src/rules/rules.service';
import { RulesController } from '../src/rules/rules.controller';
import { ComplianceService } from '../src/compliance/compliance.service';
import { ComplianceController } from '../src/compliance/compliance.controller';
import { CSV_COLUMNS, EXAMPLE_PREFIX, csvTemplate, parseCsv, ruleKey, validateImport } from '../src/rules/rule-csv';
import { describeReasons, matchRules, terms, words } from '../src/rules/rule-matching';
import { ROLES_KEY } from '../src/auth/decorators/roles.decorator';

type Row = Record<string, any>;
const ORG = 'org-a', OTHER = 'org-b', USER = 'user-1';
const status = (code: number, message?: RegExp) => (e: any) => e.status === code && (!message || message.test(e.message));
const LOTS = [{ id: 'lot-elec', name: 'Électricité', code: 'CFO' }, { id: 'lot-plomb', name: 'Plomberie', code: null }];

const rule = (id: string, extra: Row = {}): Row => ({
  id, organizationId: ORG, active: true, lotId: null, buildingType: null, erpType: null, severity: 'MEDIUM', domain: 'Général', title: `Règle ${id}`, workType: null,
  summary: 'Résumé', requirement: 'Exigence', condition: null, controlPoint: null, actionRequest: null, evidenceRequired: null, reference: null, sourceDocument: null, ...extra,
});
// A small library for organisation A, one rule for organisation B.
const library = (): Row[] => [
  rule('r-desenfumage', { title: 'Désenfumage des cages d’escalier', domain: 'Sécurité incendie', workType: 'Cloisonnement', requirement: 'Un exutoire est prévu en partie haute de chaque cage d’escalier.', reference: 'Cahier interne CI-12', sourceDocument: 'Référentiel interne 2026', controlPoint: 'Vérifier la présence de l’exutoire sur les plans.', actionRequest: 'Prévoir l’exutoire avant fermeture des cloisons.', severity: 'CRITICAL' }),
  rule('r-differentiel', { title: 'Protection différentielle des circuits', domain: 'Sécurité électrique', workType: 'Tableau électrique', lotId: 'lot-elec', requirement: 'Chaque circuit de prises est protégé par un dispositif différentiel.', reference: 'Cahier interne CI-30', severity: 'HIGH' }),
  rule('r-calorifuge', { title: 'Calorifugeage des réseaux', domain: 'Thermique', lotId: 'lot-plomb', requirement: 'Les canalisations en gaine technique sont isolées.' }),
  rule('r-inactive', { title: 'Désenfumage des parkings', domain: 'Sécurité incendie', workType: 'Désenfumage', active: false }),
  rule('r-erp', { title: 'Éclairage de sécurité', domain: 'Sécurité incendie', workType: 'Éclairage', buildingType: 'ERP', requirement: 'Blocs autonomes sur les dégagements.' }),
  rule('r-other-org', { organizationId: OTHER, title: 'Désenfumage des circulations', domain: 'Sécurité incendie', workType: 'Désenfumage', requirement: 'Règle d’une autre organisation.' }),
];

function world(options: { rules?: Row[]; ai?: { workTypes: string[]; keywords: string[] } | 'off' | 'fail' } = {}) {
  let n = 0;
  const db = {
    rules: options.rules ?? library(), versions: [] as Row[], activity: [] as Row[], checks: [] as Row[], works: [] as Row[], observations: [] as Row[], emails: [] as Row[], history: [] as Row[],
    projects: [{ id: 'P1', name: 'Résidence Test', organizationId: ORG, buildingType: 'HABITATION', erpType: null, organization: { reminderDays: 7 }, lots: [{ lotId: 'lot-elec', lot: LOTS[0], company: { id: 'c1', email: 'elec@example.com' }, contactEmail: null }] }, { id: 'PX', name: 'Autre', organizationId: OTHER, buildingType: 'HABITATION', erpType: null, organization: { reminderDays: 7 }, lots: [] }] as Row[],
  };
  const lot = (id: string | null) => LOTS.find(l => l.id === id) || null;
  const counts = (r: Row) => ({ versions: db.versions.filter(v => v.ruleId === r.id).length, observations: db.observations.filter(o => o.ruleId === r.id).length, complianceChecks: db.checks.filter(c => c.ruleId === r.id).length });
  const view = (r: Row) => ({ ...r, lot: lot(r.lotId), _count: counts(r), versions: db.versions.filter(v => v.ruleId === r.id).sort((a, b) => b.version - a.version) });
  const matchRule = (r: Row, where: Row = {}) => (where.id === undefined || (typeof where.id === 'object' ? r.id !== where.id.not : r.id === where.id)) && (where.organizationId === undefined || r.organizationId === where.organizationId) && (where.active === undefined || r.active === where.active);
  const ruleApi = {
    findMany: async ({ where }: any = {}) => db.rules.filter(r => matchRule(r, where)).map(view),
    findFirst: async ({ where }: any) => { const r = db.rules.find(x => matchRule(x, where)); return r ? view(r) : null; },
    count: async ({ where }: any = {}) => db.rules.filter(r => matchRule(r, where)).length,
    create: async ({ data }: any) => { const r = { id: `rule-${++n}`, condition: null, ...data }; db.rules.push(r); return { ...r }; },
    update: async ({ where, data }: any) => ({ ...Object.assign(db.rules.find(r => r.id === where.id)!, data) }),
    delete: async ({ where }: any) => { db.rules = db.rules.filter(r => r.id !== where.id); },
  };
  const versionApi = { create: async ({ data }: any) => { db.versions.push({ id: `v-${++n}`, ...data }); } };
  const prisma: any = {
    rule: ruleApi, ruleVersion: versionApi,
    lot: { findUnique: async ({ where }: any) => lot(where.id), findMany: async () => LOTS },
    activityLog: { create: async ({ data }: any) => { db.activity.push(data); } },
    $transaction: async (fn: any) => { const before = { rules: [...db.rules], versions: [...db.versions] }; try { return await fn({ rule: ruleApi, ruleVersion: versionApi }); } catch (e) { db.rules = before.rules; db.versions = before.versions; throw e; } },
    project: { findUnique: async ({ where }: any) => db.projects.find(p => p.id === where.id) || null },
    workDescription: {
      create: async ({ data }: any) => { const w = { id: `wd-${++n}`, ...data }; db.works.push(w); return w; },
      findFirst: async ({ where }: any) => { const w = db.works.find(x => x.id === where.id); const p = w && db.projects.find(x => x.id === w.projectId); return w && p && p.organizationId === where.project.organizationId ? { ...w, project: p } : null; },
    },
    complianceCheck: {
      create: async ({ data }: any) => { const c = { id: `chk-${++n}`, ...data }; db.checks.push(c); return c; },
      findMany: async ({ where }: any) => db.checks.filter(c => c.workDescriptionId === where.workDescriptionId && where.ruleId.in.includes(c.ruleId) && c.projectId === where.projectId).map(c => ({ ...c, rule: view(db.rules.find(r => r.id === c.ruleId)!) })).filter((c: any) => c.rule.organizationId === where.rule.organizationId),
      update: async ({ where, data }: any) => Object.assign(db.checks.find(c => c.id === where.id)!, data),
    },
    observation: {
      findFirst: async ({ where }: any) => db.observations.find(o => o.projectId === where.projectId && o.ruleId === where.ruleId && o.status !== where.status.not) || null,
      create: async ({ data }: any) => { const o = { id: `obs-${++n}`, ...data }; db.observations.push(o); return o; },
    },
    observationHistory: { create: async ({ data }: any) => { db.history.push(data); } },
    generatedEmail: { create: async ({ data }: any) => { db.emails.push(data); } },
  };
  const aiCalls: string[] = [];
  const ai = {
    isConfigured: () => options.ai !== undefined && options.ai !== 'off',
    json: async (system: string, user: string) => { aiCalls.push(`${system}\n${user}`); if (options.ai === 'fail') throw new Error('ai down'); return { data: options.ai, model: 'test-model' }; },
  };
  return { db, prisma, rules: new RulesService(prisma), compliance: new ComplianceService(prisma, ai as any), aiCalls };
}
const csv = (...lines: string[]) => ({ buffer: Buffer.from(lines.join('\r\n'), 'utf8'), originalname: 'regles.csv' }) as any;
const HEADER = 'titre;categorie;lot;type_travaux;description;exigence;reference;source;gravite;verification;action_preventive;justificatif;type_batiment;type_erp;actif';

// ---------- organisation scoping and roles ----------

test('an organisation only sees its own rules', async () => {
  const w = world();
  const mine = await w.rules.list(ORG), theirs = await w.rules.list(OTHER);
  assert.deepEqual(mine.map(r => r.id).sort(), ['r-calorifuge', 'r-desenfumage', 'r-differentiel', 'r-erp', 'r-inactive']);
  assert.deepEqual(theirs.map(r => r.id), ['r-other-org']);
  assert.deepEqual(await w.rules.summary(ORG), { total: 5, active: 4, inactive: 1 });
  assert.deepEqual(await w.rules.summary('org-empty'), { total: 0, active: 0, inactive: 0 });
});

test('organisation A cannot read, edit, deactivate or delete a rule of organisation B', async () => {
  const w = world();
  await assert.rejects(() => w.rules.get('r-other-org', ORG), status(404));
  await assert.rejects(() => w.rules.update('r-other-org', { title: 'Piratée' } as any, ORG, USER), status(404));
  await assert.rejects(() => w.rules.update('r-other-org', { active: false } as any, ORG, USER), status(404));
  await assert.rejects(() => w.rules.remove('r-other-org', ORG, USER), status(404));
  const untouched = w.db.rules.find(r => r.id === 'r-other-org')!;
  assert.deepEqual({ title: untouched.title, active: untouched.active }, { title: 'Désenfumage des circulations', active: true });
  assert.equal(w.db.activity.length, 0);
  // and a new rule always lands in the caller's organisation
  const created = await w.rules.create({ title: 'Nouvelle', domain: 'Test', requirement: 'Exigence', organizationId: OTHER } as any, ORG, USER);
  assert.equal(w.db.rules.find(r => r.id === created.id)!.organizationId, ORG);
});

test('consultants cannot create, edit, delete or import rules, nor run or convert a pre-control; they can read', () => {
  const roles = (controller: any, method: string) => Reflect.getMetadata(ROLES_KEY, controller.prototype[method]);
  for (const method of ['create', 'update', 'remove', 'preview', 'import', 'template']) {
    assert.deepEqual(roles(RulesController, method), ['ADMIN', 'EDITOR'], method);
    assert.equal(roles(RulesController, method).includes('USER'), false);
  }
  for (const method of ['list', 'summary', 'get']) assert.equal(roles(RulesController, method), undefined, `${method} is open to every signed-in member`);
  for (const method of ['precheck', 'materialize']) assert.deepEqual(roles(ComplianceController, method), ['ADMIN', 'EDITOR'], method);
});

// ---------- rule management ----------

test('a rule is created with its fields, gets a first version and an activity entry', async () => {
  const w = world({ rules: [] });
  const r = await w.rules.create({ title: '  Garde-corps  ', domain: 'Sécurité des personnes', requirement: 'Hauteur minimale respectée.', lotId: 'lot-elec', workType: 'Serrurerie', reference: 'Clause 4.2', sourceDocument: 'CCTP', severity: 'HIGH', controlPoint: 'Mesurer la hauteur.', actionRequest: 'Prévoir la rehausse.', evidenceRequired: 'Photo', summary: '' } as any, ORG, USER);
  assert.deepEqual({ title: r.title, summary: r.summary, lot: r.lot?.name, reference: r.reference, source: r.sourceDocument, active: r.active, severity: r.severity }, { title: 'Garde-corps', summary: 'Hauteur minimale respectée.', lot: 'Électricité', reference: 'Clause 4.2', source: 'CCTP', active: true, severity: 'HIGH' });
  assert.equal(w.db.versions.length, 1);
  assert.equal(w.db.activity[0].action, 'Règle ajoutée (Garde-corps)');
  await assert.rejects(() => w.rules.create({ title: 'X', domain: 'Y', requirement: 'Z', lotId: 'no-such-lot' } as any, ORG, USER), status(400, /Lot introuvable/));
  await assert.rejects(() => w.rules.create({ title: '   ', domain: 'Y', requirement: 'Z' } as any, ORG, USER), status(400));
});

test('editing changes only what is sent; a new requirement is kept as a new version', async () => {
  const w = world();
  await w.rules.update('r-desenfumage', { severity: 'HIGH', reference: null } as any, ORG, USER);
  let r = w.db.rules.find(x => x.id === 'r-desenfumage')!;
  assert.deepEqual({ severity: r.severity, reference: r.reference, title: r.title }, { severity: 'HIGH', reference: null, title: 'Désenfumage des cages d’escalier' });
  assert.equal(w.db.versions.length, 0, 'no new version when the requirement did not change');
  await w.rules.update('r-desenfumage', { requirement: 'Nouvelle exigence.' } as any, ORG, USER);
  assert.deepEqual(w.db.versions.map(v => [v.version, v.requirement]), [[1, 'Nouvelle exigence.']]);
  await assert.rejects(() => w.rules.update('r-desenfumage', { title: ' ' } as any, ORG, USER), status(400));
});

test('a rule can be deactivated and reactivated', async () => {
  const w = world();
  await w.rules.update('r-desenfumage', { active: false } as any, ORG, USER);
  assert.equal(w.db.rules.find(r => r.id === 'r-desenfumage')!.active, false);
  assert.equal(w.db.activity.at(-1)!.action, 'Règle désactivée (Désenfumage des cages d’escalier)');
  await w.rules.update('r-inactive', { active: true } as any, ORG, USER);
  assert.equal(w.db.activity.at(-1)!.action, 'Règle activée (Désenfumage des parkings)');
  assert.deepEqual(await w.rules.summary(ORG), { total: 5, active: 4, inactive: 1 });
});

test('a rule is deleted only when nothing refers to it', async () => {
  const w = world();
  w.db.checks.push({ id: 'c1', ruleId: 'r-desenfumage' });
  w.db.observations.push({ id: 'o1', ruleId: 'r-differentiel', projectId: 'P1', status: 'OPEN' });
  await assert.rejects(() => w.rules.remove('r-desenfumage', ORG, USER), status(409, /Désactivez-la/));
  await assert.rejects(() => w.rules.remove('r-differentiel', ORG, USER), status(409));
  assert.deepEqual(await w.rules.remove('r-calorifuge', ORG, USER), { deleted: true, id: 'r-calorifuge' });
  assert.equal(w.db.rules.some(r => r.id === 'r-calorifuge'), false);
  assert.equal(w.db.rules.some(r => r.id === 'r-desenfumage'), true);
});

test('duplicate rules are refused: same title, lot and reference, whatever the case or accents', async () => {
  const w = world();
  await assert.rejects(() => w.rules.create({ title: 'DESENFUMAGE des cages d\'escalier', domain: 'x', requirement: 'y', reference: 'cahier interne ci-12' } as any, ORG, USER), status(409, /identique existe déjà/));
  // same title on another lot or with another reference is a different rule
  assert.ok(await w.rules.create({ title: 'Désenfumage des cages d’escalier', domain: 'x', requirement: 'y', reference: 'Autre référence' } as any, ORG, USER));
  assert.ok(await w.rules.create({ title: 'Désenfumage des cages d’escalier', domain: 'x', requirement: 'y', reference: 'Cahier interne CI-12', lotId: 'lot-plomb' } as any, ORG, USER));
  // the other organisation may have the same rule
  assert.ok(await w.rules.create({ title: 'Désenfumage des cages d’escalier', domain: 'x', requirement: 'y', reference: 'Cahier interne CI-12' } as any, OTHER, USER));
  // renaming a rule onto an existing one is refused too
  await assert.rejects(() => w.rules.update('r-inactive', { title: 'Désenfumage des cages d’escalier', reference: 'Cahier interne CI-12' } as any, ORG, USER), status(409));
  assert.equal(ruleKey({ title: 'A  b', lotId: null, reference: 'É-1' }), ruleKey({ title: 'a B', reference: 'e 1' }));
});

// ---------- CSV ----------

test('CSV parsing: separators, quotes, line breaks in cells, BOM and empty lines', () => {
  assert.deepEqual(parseCsv('﻿a;b;c\r\n1;"x;y";"il a dit ""oui"""\r\n\r\n2;"sur\ndeux lignes";z\r\n').map(r => r.cells), [['a', 'b', 'c'], ['1', 'x;y', 'il a dit "oui"'], ['2', 'sur\ndeux lignes', 'z']]);
  assert.deepEqual(parseCsv('a,b\n1,2').map(r => r.cells), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2').map(r => r.cells), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a;b\n1;2\n3;4').map(r => r.line), [1, 2, 3]);
  assert.deepEqual(parseCsv('a;b\n"x\ny";2\n3;4').map(r => r.line), [1, 2, 4], 'line numbers follow the file');
  assert.deepEqual(parseCsv(''), []);
});

test('the CSV template has every column and one example line that cannot be imported', () => {
  const template = csvTemplate();
  assert.ok(template.startsWith('﻿'), 'BOM for spreadsheet software');
  const rows = parseCsv(template);
  assert.deepEqual(rows[0].cells, CSV_COLUMNS.map(c => c.header));
  assert.equal(rows[0].cells.join(';'), HEADER);
  assert.equal(rows.length, 2);
  const preview = validateImport(template, { lots: LOTS, existingKeys: new Set() });
  assert.equal(preview.canImport, false);
  assert.ok(preview.rows[0].errors.some(e => /Ligne d’exemple du modèle/.test(e)));
  assert.ok(rows[1].cells[0].startsWith(EXAMPLE_PREFIX));
});

test('valid CSV import: preview first, then every line is created in the caller’s organisation', async () => {
  const w = world({ rules: [] });
  const file = csv(HEADER,
    'Garde-corps des mezzanines;Sécurité des personnes;;Serrurerie;Hauteur des garde-corps;Hauteur minimale respectée;Clause 4.2;CCTP lot 7;Élevée;Mesurer la hauteur;Prévoir la rehausse;Photo;;;oui',
    '"Protection; différentielle";Sécurité électrique;cfo;Tableau électrique;;Dispositif différentiel sur chaque circuit;CI-30;;critique;;;;HABITATION;;',
    'Règle en attente;Divers;Plomberie;;;À préciser;;;;;;;;;non');
  const preview = await w.rules.preview(file, ORG);
  assert.deepEqual(preview.summary, { total: 3, valid: 3, errors: 0, duplicates: 0 });
  assert.equal(preview.canImport, true);
  assert.equal(w.db.rules.length, 0, 'the preview writes nothing');
  assert.deepEqual(preview.rows.map(r => [r.line, r.status, r.rule.lotName, r.rule.severity, r.rule.active]), [[2, 'OK', null, 'HIGH', true], [3, 'OK', 'Électricité', 'CRITICAL', true], [4, 'OK', 'Plomberie', 'MEDIUM', false]]);

  const result = await w.rules.import(file, ORG, USER);
  assert.deepEqual(result, { created: 3, duplicatesSkipped: 0, total: 3 });
  assert.equal(w.db.rules.length, 3);
  assert.ok(w.db.rules.every(r => r.organizationId === ORG));
  const second = w.db.rules.find(r => r.title === 'Protection; différentielle')!;
  assert.deepEqual({ lot: second.lotId, summary: second.summary, building: second.buildingType, reference: second.reference, source: second.sourceDocument }, { lot: 'lot-elec', summary: 'Dispositif différentiel sur chaque circuit', building: 'HABITATION', reference: 'CI-30', source: null });
  assert.equal(w.db.versions.length, 3);
  assert.equal(w.db.activity.at(-1)!.action, 'Import de règles : 3 règle(s) ajoutée(s)');
  assert.deepEqual(await w.rules.summary(ORG), { total: 3, active: 2, inactive: 1 });
});

test('invalid CSV rows are reported line by line, and nothing at all is imported', async () => {
  const w = world({ rules: [] });
  const file = csv(HEADER,
    'Règle valide;Divers;;;;Exigence;;;;;;;;;',
    ';Divers;;;;Exigence;;;;;;;;;',
    'Sans exigence;Divers;;;;;;;;;;;;;',
    'Lot inconnu;Divers;Menuiserie extérieure;;;Exigence;;;;;;;;;',
    'Gravité fausse;Divers;;;;Exigence;;;urgent;;;;;;',
    'Bâtiment faux;Divers;;;;Exigence;;;;;;;USINE;;peut-être',
    `${'T'.repeat(201)};Divers;;;;Exigence;;;;;;;;;`);
  const preview = await w.rules.preview(file, ORG);
  assert.deepEqual(preview.summary, { total: 7, valid: 1, errors: 6, duplicates: 0 });
  assert.equal(preview.canImport, false);
  const errors = Object.fromEntries(preview.rows.map(r => [r.line, r.errors.join(' | ')]));
  assert.equal(errors[2], '');
  assert.match(errors[3], /Titre : valeur obligatoire/);
  assert.match(errors[4], /Exigence : valeur obligatoire/);
  assert.match(errors[5], /Lot inconnu : « Menuiserie extérieure »/);
  assert.match(errors[6], /Sévérité invalide : « urgent »/);
  assert.match(errors[7], /Type de bâtiment invalide : « USINE »/);
  assert.match(errors[7], /Valeur « actif » invalide : « peut-être »/);
  assert.match(errors[8], /Titre : 201 caractères, 200 au maximum/);

  await assert.rejects(() => w.rules.import(file, ORG, USER), status(400, /6 ligne\(s\) invalide\(s\) : rien n’a été importé/));
  assert.equal(w.db.rules.length, 0, 'not even the valid line');
  assert.equal(w.db.activity.length, 0);
});

test('unusable files are refused with a clear reason', async () => {
  const w = world({ rules: [] });
  assert.match((await w.rules.preview(csv('titre;lot', 'A;B'), ORG)).fileErrors[0], /Colonne\(s\) obligatoire\(s\) absente\(s\) : categorie, exigence/);
  assert.match((await w.rules.preview(csv(HEADER), ORG)).fileErrors[0], /aucune règle/);
  await assert.rejects(() => w.rules.preview(undefined, ORG), status(400, /manquant ou vide/));
  await assert.rejects(() => w.rules.preview({ buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0xff, 0xfe, 0xfd, 0xfc]) } as any, ORG), status(400, /illisible/));
  await assert.rejects(() => w.rules.preview({ buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 'a') } as any, ORG), status(400, /trop volumineux/));
  await assert.rejects(() => w.rules.import(csv('titre;lot', 'A;B'), ORG, USER), status(400));
  const many = csv(HEADER, ...Array.from({ length: 1001 }, (_, i) => `Règle ${i};Divers;;;;Exigence;;;;;;;;;`));
  assert.match((await w.rules.preview(many, ORG)).fileErrors[0], /1001 lignes : 1000 au maximum/);
  // unknown columns are reported, and header aliases are accepted
  const aliased = await w.rules.preview(csv('Title;Domaine;Requirement;Commentaire', 'A;B;C;D'), ORG);
  assert.deepEqual({ unknown: aliased.unknownColumns, valid: aliased.summary.valid }, { unknown: ['Commentaire'], valid: 1 });
});

test('duplicates are detected against the library and inside the file; they are skipped and reported', async () => {
  const w = world();
  const file = csv(HEADER,
    'désenfumage des cages d\'escalier;Sécurité incendie;;;;Texte;CAHIER INTERNE CI-12;;;;;;;;',
    'Nouvelle règle;Divers;;;;Exigence;R-1;;;;;;;;',
    'NOUVELLE RÈGLE;Divers;;;;Autre texte;r 1;;;;;;;;',
    'Désenfumage des circulations;Sécurité incendie;;;;Présente chez une autre organisation seulement;;;;;;;;;');
  const preview = await w.rules.preview(file, ORG);
  assert.deepEqual(preview.rows.map(r => [r.status, r.duplicateOf || null]), [['DUPLICATE', 'LIBRARY'], ['OK', null], ['DUPLICATE', 'FILE'], ['OK', null]]);
  assert.deepEqual(preview.summary, { total: 4, valid: 2, errors: 0, duplicates: 2 });
  const before = w.db.rules.length;
  assert.deepEqual(await w.rules.import(file, ORG, USER), { created: 2, duplicatesSkipped: 2, total: 4 });
  assert.equal(w.db.rules.length, before + 2);
  // importing the same file again adds nothing and says so
  await assert.rejects(() => w.rules.import(file, ORG, USER), status(400, /Aucune nouvelle règle à importer/));
  assert.equal(w.db.rules.length, before + 2);
});

// ---------- matching ----------

const ids = (list: { rule: { id: string } }[]) => list.map(m => m.rule.id);
const mine = () => library().filter(r => r.organizationId === ORG) as any[];

test('an active rule that matches the described works is returned, with the reason', () => {
  const matches = matchRules(mine(), { description: 'Création de cloisons et fermeture de la cage d’escalier du bâtiment B', buildingType: 'HABITATION' });
  assert.deepEqual(ids(matches), ['r-desenfumage']);
  assert.deepEqual(matches[0].reasons.terms.map(t => [t.term, t.field, t.fromAi]).sort(), [['cage', 'title', false], ['cloisons', 'workType', false], ['escalier', 'title', false]]);
  assert.equal(matches[0].reasons.lot, false);
  assert.match(describeReasons(matches[0].reasons), /Termes communs : « cloisons » \(type de travaux\)/);
});

test('an inactive rule never matches, even on its exact title', () => {
  assert.deepEqual(ids(matchRules(mine(), { description: 'Désenfumage des parkings', buildingType: 'HABITATION' })), ['r-desenfumage'], 'only the active rule that shares the word');
  assert.deepEqual(matchRules([rule('only', { title: 'Désenfumage des parkings', active: false })] as any[], { description: 'Désenfumage des parkings' }), []);
});

test('no matching rule gives a truly empty result', () => {
  assert.deepEqual(matchRules(mine(), { description: 'Peinture des façades et ravalement', buildingType: 'HABITATION' }), []);
  assert.deepEqual(matchRules(mine(), { description: '', buildingType: 'HABITATION' }), []);
  // generic site vocabulary alone never makes a match
  assert.deepEqual(matchRules(mine(), { description: 'Travaux d’installation et de mise en place dans le bâtiment existant', buildingType: 'HABITATION' }), []);
  assert.deepEqual(matchRules([], { description: 'Désenfumage' }), []);
});

test('context filters: building type, ERP type and lot', () => {
  const lighting = 'Remplacement de l’éclairage de sécurité des dégagements';
  assert.deepEqual(ids(matchRules(mine(), { description: lighting, buildingType: 'HABITATION' })), [], 'an ERP rule does not apply to housing');
  assert.deepEqual(ids(matchRules(mine(), { description: lighting, buildingType: 'ERP' })), ['r-erp']);
  const typed = [rule('m', { title: 'Éclairage de sécurité', erpType: 'M' })] as any[];
  assert.deepEqual(ids(matchRules(typed, { description: lighting, erpType: 'N' })), []);
  assert.deepEqual(ids(matchRules(typed, { description: lighting, erpType: 'm' })), ['m']);
  // a rule of another lot is excluded when a lot is chosen; a rule of the chosen lot is included even without a common word
  const electrical = 'Remplacement du tableau électrique';
  assert.deepEqual(ids(matchRules(mine(), { description: electrical, lotId: 'lot-plomb', buildingType: 'HABITATION' })), ['r-calorifuge']);
  const withLot = matchRules(mine(), { description: 'Reprise des réseaux', lotId: 'lot-elec', buildingType: 'HABITATION' });
  assert.deepEqual(ids(withLot), ['r-differentiel']);
  assert.deepEqual(withLot[0].reasons, { terms: [], lot: true });
  assert.match(describeReasons(withLot[0].reasons, 'Électricité'), /Règle du lot sélectionné \(Électricité\)/);
});

test('matching ignores accents, plurals and close word forms; the best match comes first', () => {
  assert.deepEqual(terms('Les Tableaux électriques, 2 portes et 1 exutoire'), ['tableau', 'electriqu', 'porte', 'exutoir']);
  assert.deepEqual(words('Les Tableaux électriques, 2 portes et 1 exutoire'), ['tableaux', 'électriques', 'portes', 'exutoire']);
  const matches = matchRules(mine(), { description: 'Modification des tableaux electriques et de l’electricite des cages d’escaliers', buildingType: 'HABITATION' });
  assert.deepEqual(ids(matches), ['r-differentiel', 'r-desenfumage']);
  assert.ok(matches[0].score >= matches[1].score);
});

test('AI terms only widen the vocabulary: they are flagged, and cannot match what the library does not contain', () => {
  const rules = mine();
  assert.deepEqual(ids(matchRules(rules, { description: 'Reprise du TGBT', buildingType: 'HABITATION' })), []);
  const widened = matchRules(rules, { description: 'Reprise du TGBT', aiTerms: ['tableau électrique', 'armoire'], buildingType: 'HABITATION' });
  assert.deepEqual(ids(widened), ['r-differentiel']);
  assert.ok(widened[0].reasons.terms.every(t => t.fromAi));
  assert.match(describeReasons(widened[0].reasons), /terme normalisé/);
  assert.deepEqual(matchRules(rules, { description: 'Reprise du TGBT', aiTerms: ['ascenseur', 'monte-charge'], buildingType: 'HABITATION' }), []);
});

// ---------- pre-control service ----------

test('pre-control matches only active rules of the caller’s organisation, and returns the rule content untouched', async () => {
  const w = world();
  const result: any = await w.compliance.precheck('P1', 'Désenfumage : fermeture de la cage d’escalier par des cloisons', undefined, ORG, USER);
  assert.deepEqual(result.matches.map((m: any) => m.rule.id), ['r-desenfumage'], 'not the inactive one, not the other organisation’s');
  const m = result.matches[0].rule, source = w.db.rules.find(r => r.id === 'r-desenfumage')!;
  for (const field of ['title', 'requirement', 'reference', 'sourceDocument', 'controlPoint', 'actionRequest', 'severity']) assert.equal(m[field], source[field], field);
  assert.deepEqual({ empty: result.emptyLibrary, active: result.libraryActiveRules, evaluated: result.evaluatedRules, ai: result.aiUsed }, { empty: false, active: 4, evaluated: 4, ai: false });
  assert.equal(w.db.checks.length, 1);
  assert.match(w.db.checks[0].reasoning, /Termes communs/);
  assert.equal(JSON.stringify(result).includes('autre organisation'), false);
  await assert.rejects(() => w.compliance.precheck('PX', 'Désenfumage', undefined, ORG, USER), status(403), 'a project of another organisation');
});

test('when nothing matches the result is empty: no rule, no reference, no guidance of any kind', async () => {
  const w = world({ ai: { workTypes: ['peinture'], keywords: ['ravalement', 'façade'] } });
  const result: any = await w.compliance.precheck('P1', 'Peinture des façades et ravalement', undefined, ORG, USER);
  assert.deepEqual(result.matches, []);
  assert.deepEqual(Object.keys(result).sort(), ['aiUsed', 'emptyLibrary', 'evaluatedRules', 'libraryActiveRules', 'matches', 'terms', 'workDescriptionId']);
  assert.equal(w.db.checks.length, 0);
  for (const invented of ['risks', 'documentsRequired', 'contractorInstructions', 'reference', 'recommend']) assert.equal(JSON.stringify(result).includes(invented), false, invented);
});

test('the AI is only asked to normalise vocabulary; a reference it might return is never used', async () => {
  const w = world({ ai: { workTypes: ['tableau électrique'], keywords: ['armoire'], reference: 'NF X 99-999 inventée', risks: ['Risque inventé'] } as any });
  const result: any = await w.compliance.precheck('P1', 'Reprise du TGBT', undefined, ORG, USER);
  assert.match(w.aiCalls[0], /Do not give advice, risks, instructions, requirements, standards or regulatory references/);
  assert.deepEqual(result.matches.map((m: any) => m.rule.id), ['r-differentiel']);
  assert.equal(result.matches[0].rule.reference, 'Cahier interne CI-30', 'the reference is the one stored in the rule');
  assert.equal(result.aiUsed, true);
  assert.deepEqual(result.terms.fromAi.sort(), ['armoire', 'tableau', 'électrique']);
  assert.deepEqual(result.terms.fromText, ['reprise', 'tgbt'], 'words are shown as written, not as stems');
  assert.equal(JSON.stringify(result).includes('inventé'), false);
  // if the AI is down the comparison still runs on the words of the description
  const down = world({ ai: 'fail' });
  const fallback: any = await down.compliance.precheck('P1', 'Remplacement du tableau électrique', undefined, ORG, USER);
  assert.deepEqual({ ids: fallback.matches.map((m: any) => m.rule.id), ai: fallback.aiUsed }, { ids: ['r-differentiel'], ai: false });
});

test('empty library: the pre-control says so and does nothing else', async () => {
  for (const rules of [[], [rule('off', { active: false })], [rule('theirs', { organizationId: OTHER, title: 'Désenfumage' })]]) {
    const w = world({ rules, ai: { workTypes: ['désenfumage'], keywords: [] } });
    const result: any = await w.compliance.precheck('P1', 'Désenfumage des circulations', undefined, ORG, USER);
    assert.deepEqual({ empty: result.emptyLibrary, matches: result.matches, wd: result.workDescriptionId, active: result.libraryActiveRules }, { empty: true, matches: [], wd: null, active: 0 });
    assert.equal(w.db.works.length + w.db.checks.length, 0);
    assert.equal(w.aiCalls.length, 0, 'the AI is not even called');
  }
  await assert.rejects(() => world().compliance.precheck('P1', '   ', undefined, ORG, USER), status(400));
});

// ---------- conversion to observations ----------

test('a pre-control finding becomes an observation that carries the rule, its reference, lot, action and severity', async () => {
  const w = world();
  const pre: any = await w.compliance.precheck('P1', 'Remplacement du tableau électrique', 'lot-elec', ORG, USER);
  const result = await w.compliance.materialize(pre.workDescriptionId, ['r-differentiel'], ORG, USER);
  assert.deepEqual({ created: result.observationsCreated, existing: result.alreadyExisting, drafts: result.draftsCreated }, { created: 1, existing: 0, drafts: 1 });
  const o = w.db.observations[0];
  assert.deepEqual({ ruleId: o.ruleId, title: o.title, description: o.description, reference: o.reference, lotId: o.lotId, severity: o.severity, companyId: o.companyId, status: o.status, projectId: o.projectId },
    { ruleId: 'r-differentiel', title: 'Protection différentielle des circuits', description: 'Chaque circuit de prises est protégé par un dispositif différentiel.', reference: 'Cahier interne CI-30', lotId: 'lot-elec', severity: 'HIGH', companyId: 'c1', status: 'TO_SEND', projectId: 'P1' });
  assert.equal(o.aiConfidence, undefined, 'it is not an AI finding');
  assert.match(w.db.history[0].note, /Action créée depuis le pré-contrôle \(règle : Protection différentielle des circuits\)/);
  assert.match(w.db.emails[0].body, /Référence : Cahier interne CI-30/);
  // the recommended action comes from the rule: preventive action first, otherwise the check instructions
  const pre2: any = await w.compliance.precheck('P1', 'Cloisons de la cage d’escalier', undefined, ORG, USER);
  await w.compliance.materialize(pre2.workDescriptionId, ['r-desenfumage'], ORG, USER);
  assert.equal(w.db.observations[1].requiredAction, 'Prévoir l’exutoire avant fermeture des cloisons.');
  assert.equal(w.db.observations[1].status, 'OPEN', 'no lot company: nothing to send yet');
});

test('converting the same finding twice does not create a duplicate observation', async () => {
  const w = world();
  const pre: any = await w.compliance.precheck('P1', 'Remplacement du tableau électrique', 'lot-elec', ORG, USER);
  await w.compliance.materialize(pre.workDescriptionId, ['r-differentiel', 'r-differentiel'], ORG, USER);
  const again = await w.compliance.materialize(pre.workDescriptionId, ['r-differentiel'], ORG, USER);
  assert.deepEqual({ created: again.observationsCreated, existing: again.alreadyExisting, ids: again.observationIds }, { created: 0, existing: 1, ids: [w.db.observations[0].id] });
  // a second pre-control of the same works does not duplicate it either, even if the rule was renamed meanwhile
  await w.rules.update('r-differentiel', { title: 'Protection différentielle (renommée)' } as any, ORG, USER);
  const pre2: any = await w.compliance.precheck('P1', 'Nouveau tableau électrique', 'lot-elec', ORG, USER);
  const third = await w.compliance.materialize(pre2.workDescriptionId, ['r-differentiel'], ORG, USER);
  assert.deepEqual({ created: third.observationsCreated, existing: third.alreadyExisting }, { created: 0, existing: 1 });
  assert.equal(w.db.observations.length, 1);
  assert.equal(w.db.emails.length, 1);
  // once the observation is closed, the same rule may raise a new one
  w.db.observations[0].status = 'RESOLVED';
  assert.equal((await w.compliance.materialize(pre2.workDescriptionId, ['r-differentiel'], ORG, USER)).observationsCreated, 1);
});

test('only findings of that pre-control and of the caller’s organisation can be converted', async () => {
  const w = world();
  const pre: any = await w.compliance.precheck('P1', 'Remplacement du tableau électrique', 'lot-elec', ORG, USER);
  await assert.rejects(() => w.compliance.materialize(pre.workDescriptionId, ['r-desenfumage'], ORG, USER), status(400), 'a rule that was not a finding of this pre-control');
  await assert.rejects(() => w.compliance.materialize(pre.workDescriptionId, ['r-other-org'], ORG, USER), status(400));
  await assert.rejects(() => w.compliance.materialize(pre.workDescriptionId, ['r-differentiel'], OTHER, 'intruder'), status(404));
  assert.equal(w.db.observations.length, 0);
});

// ---------- migration safety ----------

test('the migrations never attribute an existing rule to an organisation, never delete one, and make the organisation mandatory', () => {
  const dir = join(__dirname, '..', 'prisma', 'migrations');
  const sql = (name: string) => readFileSync(join(dir, name, 'migration.sql'), 'utf8').replace(/^\s*--.*$/gm, '');
  const library = sql('20261003220000_rules_library'), required = sql('20261003230000_rules_organization_required');
  for (const text of [library, required]) {
    assert.doesNotMatch(text, /SET\s+"organizationId"\s*=/i, 'no rule is given an organisation by a migration');
    assert.doesNotMatch(text, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i, 'no rule is deleted');
  }
  assert.match(required, /"organizationId" IS NULL[\s\S]*RAISE EXCEPTION[\s\S]*rules:assign-legacy/, 'unattributed rules stop the migration with the remediation step');
  assert.ok(required.indexOf('RAISE EXCEPTION') < required.indexOf('SET NOT NULL'), 'the guard runs before the constraint');
  assert.match(required, /ALTER TABLE "Rule" ALTER COLUMN "organizationId" SET NOT NULL/);
  const schema = readFileSync(join(dir, '..', 'schema.prisma'), 'utf8');
  assert.match(schema.slice(schema.indexOf('model Rule {')), /^\s*organizationId\s+String\s*$/m, 'a rule cannot be created without an organisation');
});

test('created and imported rules always carry the caller’s organisation, whatever the request says', async () => {
  const { db, rules } = world({ rules: [] });
  const created = await rules.create({ title: 'Règle créée', domain: 'Test', requirement: 'Exigence', organizationId: OTHER } as any, ORG, USER);
  await rules.update(created.id, { organizationId: OTHER, title: 'Règle renommée' } as any, ORG, USER);
  await rules.import(csv('titre;categorie;exigence', 'Règle importée;Test;Exigence'), ORG, USER);
  assert.equal(db.rules.length, 2);
  for (const r of db.rules) assert.equal(r.organizationId, ORG);
});
