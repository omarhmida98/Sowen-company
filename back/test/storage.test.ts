// Document storage tests. Run with: npm --workspace back test
// No bucket, credentials or database are needed: S3 is replaced by a fake client and Prisma by in-memory fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { NotFoundException, ServiceUnavailableException, StreamableFile } from '@nestjs/common';
import { LocalStorage } from '../src/storage/local-storage';
import { S3Storage } from '../src/storage/s3-storage';
import { buildKey, isLegacyPath, safeFileName, toStorageKey } from '../src/storage/storage-keys';
import { StorageNotFoundError, StorageProvider } from '../src/storage/storage.types';
import { StorageService, resolveStorageConfig } from '../src/storage/storage.service';
import { migrateStoredFiles } from '../src/storage/migrate';
import { DocumentsService } from '../src/documents/documents.service';
import { EvidenceService } from '../src/evidence/evidence.service';
import { ProjectsService } from '../src/projects/projects.service';
import { ReportsService } from '../src/reports/reports.service';

const tmpRoot = () => fs.mkdtemp(path.join(os.tmpdir(), 'sowen-storage-'));
const config = (env: Record<string, string>) => ({ get: (key: string) => env[key] }) as any;
const body = async (file: StreamableFile) => { const chunks: Buffer[] = []; for await (const c of file.getStream()) chunks.push(Buffer.from(c)); return Buffer.concat(chunks).toString(); };

// An in-memory provider, optionally failing on delete.
function memoryStorage(options: { failDelete?: boolean } = {}) {
  const files = new Map<string, Buffer>(); const calls: string[] = [];
  const provider: StorageProvider = {
    name: 's3',
    put: async (key, data) => { calls.push(`put ${key}`); files.set(key, data); },
    get: async key => { const f = files.get(key); if (!f) throw new StorageNotFoundError(key); return f; },
    delete: async key => { calls.push(`delete ${key}`); if (options.failDelete) throw new Error('storage unavailable'); files.delete(key); },
    exists: async key => files.has(key),
    check: async () => ({ ok: true }),
  };
  return { provider, files, calls };
}
// A StorageService wired to a given provider, bypassing configuration.
function serviceFor(provider: StorageProvider | null) {
  const service = new StorageService(config({ STORAGE_LOCAL_DIR: os.tmpdir() }));
  (service as any).provider = provider;
  return service;
}

// ---------- keys ----------

test('keys are relative and provider-independent; file names are sanitised', () => {
  assert.equal(buildKey('p1', 'reports', 'Rapport BC (v2).pdf', 1700000000000), 'p1/reports/1700000000000-Rapport_BC__v2_.pdf');
  assert.equal(buildKey('p1', 'evidence', 'photo.jpg', 5), 'p1/evidence/5-photo.jpg');
  assert.equal(buildKey('p1', 'documents', 'plan.pdf', 5), 'p1/5-plan.pdf');
  // A hostile file name cannot add path segments: separators are replaced and it cannot start with a dot.
  for (const hostile of ['../../etc/passwd', '..\\..\\x', '.env', '/absolute/path']) {
    const name = safeFileName(hostile);
    assert.ok(!name.includes('/') && !name.includes('\\') && !name.startsWith('.'), `${hostile} -> ${name}`);
    assert.equal(toStorageKey(buildKey('p1', 'documents', hostile, 1)), `p1/1-${name}`);
  }
});

test('legacy absolute paths are recognised and reduced to the part after "uploads"', () => {
  const windows = 'C:\\Users\\X\\sowen_final\\back\\uploads\\proj-1\\reports\\17-rapport.pdf';
  assert.equal(isLegacyPath(windows), true);
  assert.equal(toStorageKey(windows), 'proj-1/reports/17-rapport.pdf');
  assert.equal(toStorageKey('/app/back/uploads/proj-1/17-plan.pdf'), 'proj-1/17-plan.pdf');
  assert.equal(isLegacyPath('proj-1/evidence/3-photo.jpg'), false);
  assert.equal(toStorageKey('proj-1/evidence/3-photo.jpg'), 'proj-1/evidence/3-photo.jpg');
  for (const bad of ['', null, undefined, '../secret', 'a/../../b', 'C:\\Windows\\system32\\file', '/etc/passwd']) assert.equal(toStorageKey(bad as any), null, String(bad));
});

// ---------- local provider ----------

test('local storage: upload, read, exists, delete', async () => {
  const root = await tmpRoot();
  const local = new LocalStorage(root);
  await local.put('p1/reports/1-a.pdf', Buffer.from('contenu'));
  assert.equal(await local.exists('p1/reports/1-a.pdf'), true);
  assert.equal((await local.get('p1/reports/1-a.pdf')).toString(), 'contenu');
  assert.equal((await fs.readFile(path.join(root, 'p1', 'reports', '1-a.pdf'))).toString(), 'contenu');
  await local.delete('p1/reports/1-a.pdf');
  assert.equal(await local.exists('p1/reports/1-a.pdf'), false);
  await local.delete('p1/reports/1-a.pdf'); // deleting again is not an error
  assert.deepEqual(await local.check(), { ok: true });
});

test('local storage: a missing file is reported as such; keys cannot leave the root', async () => {
  const local = new LocalStorage(await tmpRoot());
  await assert.rejects(() => local.get('p1/none.pdf'), StorageNotFoundError);
  await assert.rejects(() => local.put('../outside.txt', Buffer.from('x')), /outside the storage root/);
  await assert.rejects(() => local.get('../../etc/passwd'), /outside the storage root/);
});

// ---------- S3 provider (fake client, no credentials) ----------

function fakeS3() {
  const objects = new Map<string, { body: Buffer; contentType?: string }>(); const commands: { name: string; input: any }[] = [];
  const notFound = () => Object.assign(new Error('missing'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
  const client = { send: async (command: any) => {
    const name = command.constructor.name, input = command.input; commands.push({ name, input });
    if (name === 'PutObjectCommand') { objects.set(input.Key, { body: input.Body, contentType: input.ContentType }); return {}; }
    if (name === 'GetObjectCommand') { const o = objects.get(input.Key); if (!o) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' }); return { Body: { transformToByteArray: async () => new Uint8Array(o.body) } }; }
    if (name === 'HeadObjectCommand') { if (!objects.has(input.Key)) throw notFound(); return {}; }
    if (name === 'DeleteObjectCommand') { objects.delete(input.Key); return {}; }
    if (name === 'HeadBucketCommand') { if (input.Bucket !== 'sowen-docs') throw Object.assign(new Error('denied'), { $metadata: { httpStatusCode: 403 } }); return {}; }
    throw new Error(`unexpected command ${name}`);
  } };
  return { client, objects, commands };
}
const s3Settings = { endpoint: 'https://s3.example.test', region: 'auto', bucket: 'sowen-docs', accessKeyId: 'AK', secretAccessKey: 'SK', forcePathStyle: true };

test('S3 storage: put, get, exists, delete go to the configured bucket and stay private', async () => {
  const { client, objects, commands } = fakeS3();
  const s3 = new S3Storage(s3Settings, client);
  await s3.put('p1/reports/1-a.pdf', Buffer.from('pdf'), 'application/pdf');
  assert.deepEqual([...objects.keys()], ['p1/reports/1-a.pdf']);
  const put = commands[0];
  assert.deepEqual([put.name, put.input.Bucket, put.input.Key, put.input.ContentType, put.input.ContentLength], ['PutObjectCommand', 'sowen-docs', 'p1/reports/1-a.pdf', 'application/pdf', 3]);
  assert.equal(put.input.ACL, undefined, 'no public ACL is ever set');
  assert.equal((await s3.get('p1/reports/1-a.pdf')).toString(), 'pdf');
  assert.equal(await s3.exists('p1/reports/1-a.pdf'), true);
  await s3.delete('p1/reports/1-a.pdf');
  assert.equal(await s3.exists('p1/reports/1-a.pdf'), false);
  assert.ok(commands.every(c => c.input.Bucket === 'sowen-docs'));
});

test('S3 storage: a missing object is a not-found, other errors are not swallowed', async () => {
  const { client } = fakeS3();
  const s3 = new S3Storage(s3Settings, client);
  await assert.rejects(() => s3.get('p1/none.pdf'), StorageNotFoundError);
  const broken = new S3Storage(s3Settings, { send: async () => { throw Object.assign(new Error('boom'), { name: 'InternalError', $metadata: { httpStatusCode: 500 } }); } });
  await assert.rejects(() => broken.get('k'), /boom/);
  await assert.rejects(() => broken.exists('k'), /boom/);
});

test('S3 storage: the bucket check reports a short reason without leaking settings', async () => {
  const { client } = fakeS3();
  assert.deepEqual(await new S3Storage(s3Settings, client).check(), { ok: true });
  const denied = await new S3Storage({ ...s3Settings, bucket: 'other' }, client).check();
  assert.equal(denied.ok, false);
  assert.match(denied.detail!, /access denied/);
  assert.ok(!/AK|SK|s3\.example\.test/.test(denied.detail!));
});

// ---------- configuration and status ----------

test('provider selection is explicit: S3 variables alone do not switch to object storage', () => {
  const s3Vars = { S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's', S3_ENDPOINT: 'https://e.test' };
  assert.equal(resolveStorageConfig(k => (s3Vars as any)[k]).provider, 'local');
  assert.equal(resolveStorageConfig(() => undefined).provider, 'local');
  const selected = resolveStorageConfig(k => ({ ...s3Vars, STORAGE_PROVIDER: 's3' } as any)[k]);
  assert.deepEqual([selected.provider, selected.missing, selected.s3?.bucket, selected.s3?.region, selected.s3?.forcePathStyle], ['s3', [], 'b', 'auto', true]);
  const incomplete = resolveStorageConfig(k => ({ STORAGE_PROVIDER: 's3', S3_BUCKET: 'b' } as any)[k]);
  assert.deepEqual([incomplete.s3, incomplete.missing], [null, ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']]);
  assert.equal(resolveStorageConfig(k => ({ STORAGE_PROVIDER: 'ftp' } as any)[k]).unknownProvider, 'ftp');
  const aws = resolveStorageConfig(k => ({ STORAGE_PROVIDER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's', S3_REGION: 'eu-west-3' } as any)[k]);
  assert.deepEqual([aws.s3?.endpoint, aws.s3?.forcePathStyle, aws.s3?.region], [undefined, false, 'eu-west-3']);
});

test('status reflects reality: local, object storage, misconfigured, unreachable', async () => {
  const local = new StorageService(config({ STORAGE_LOCAL_DIR: await tmpRoot() }));
  assert.deepEqual(await local.status(), { provider: 'local', state: 'local', ok: true, detail: null });
  const half = new StorageService(config({ STORAGE_PROVIDER: 's3', S3_BUCKET: 'b' }));
  const halfStatus = await half.status();
  assert.deepEqual([halfStatus.provider, halfStatus.state, halfStatus.ok], ['s3', 'misconfigured', false]);
  assert.match(halfStatus.detail!, /S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY/);
  await assert.rejects(() => half.save({ projectId: 'p', folder: 'documents', originalName: 'a.pdf', buffer: Buffer.from('x') }), ServiceUnavailableException, 'never falls back to local storage silently');
  const unknown = await new StorageService(config({ STORAGE_PROVIDER: 'ftp' })).status();
  assert.equal(unknown.state, 'misconfigured');
  const good = serviceFor(memoryStorage().provider); (good as any).providerName = 's3';
  assert.deepEqual(await good.status(), { provider: 's3', state: 'object', ok: true, detail: null });
  const down = serviceFor({ ...memoryStorage().provider, check: async () => ({ ok: false, detail: 'Object storage check failed: access denied' }) }); (down as any).providerName = 's3';
  assert.deepEqual([(await down.status()).state, (await down.status()).ok], ['error', false]);
});

// ---------- application services ----------

type Doc = { id: string; projectId: string; organizationId: string; name: string; type: string; mimeType: string; storageKey: string };
function appHarness(storage: StorageService, docs: Doc[], options: { failCreate?: boolean; reportDocumentId?: string } = {}) {
  const activity: any[] = [];
  const prisma: any = {
    project: {
      findUnique: async ({ where }: any) => (where.id === 'project-a' ? { organizationId: 'org-a' } : where.id === 'project-b' ? { organizationId: 'org-b' } : null),
      delete: async ({ where }: any) => { for (let i = docs.length - 1; i >= 0; i--) if (docs[i].projectId === where.id) docs.splice(i, 1); return { id: where.id }; },
    },
    document: {
      findFirst: async ({ where }: any) => docs.find(d => d.id === where.id && d.organizationId === where.project.organizationId) || null,
      findMany: async ({ where }: any) => docs.filter(d => d.projectId === where.projectId).map(d => ({ storageKey: d.storageKey })),
      create: async ({ data }: any) => { if (options.failCreate) throw new Error('database unavailable'); const row = { id: `doc-${docs.length + 1}`, organizationId: 'org-a', ...data }; docs.push(row); return row; },
      delete: async ({ where }: any) => { const i = docs.findIndex(d => d.id === where.id); docs.splice(i, 1); },
    },
    controlReport: {
      count: async ({ where }: any) => (where.documentId === options.reportDocumentId ? 1 : 0),
      findFirst: async ({ where }: any) => { const d = docs.find(x => x.id === options.reportDocumentId); return where.id === 'report-1' && d && d.organizationId === where.project.organizationId ? { document: { name: d.name, mimeType: d.mimeType, storageKey: d.storageKey } } : null; },
    },
    observationEvidence: { findFirst: async ({ where }: any) => { const d = docs.find(x => x.id === 'doc-evidence'); return where.id === 'evidence-1' && d && d.organizationId === where.observation.project.organizationId ? { document: { name: d.name, mimeType: d.mimeType, storageKey: d.storageKey } } : null; } },
    activityLog: { create: async ({ data }: any) => { activity.push(data); } },
  };
  return { prisma, activity, documents: new DocumentsService(prisma, storage), evidence: new EvidenceService(prisma, storage), projects: new ProjectsService(prisma, storage), reports: new ReportsService(prisma, {} as any, storage) };
}
const doc = (extra: Partial<Doc> = {}): Doc => ({ id: 'doc-1', projectId: 'project-a', organizationId: 'org-a', name: 'plan.pdf', type: 'PLAN', mimeType: 'application/pdf', storageKey: 'project-a/1-plan.pdf', ...extra });
const file = (name = 'plan.pdf') => ({ originalname: name, buffer: Buffer.from('contenu du fichier'), mimetype: 'application/pdf', size: 18 }) as any;

test('upload stores the file through the storage service and records a relative key', async () => {
  const mem = memoryStorage(); const docs: Doc[] = [];
  const app = appHarness(serviceFor(mem.provider), docs);
  const created: any = await app.documents.upload('project-a', 'PLAN', file('Plan R+1.pdf'), 'org-a', 'user-1');
  assert.match(created.storageKey, /^project-a\/\d+-Plan_R_1\.pdf$/);
  assert.ok(!isLegacyPath(created.storageKey));
  assert.equal(mem.files.get(created.storageKey)!.toString(), 'contenu du fichier');
});

test('a database failure during upload does not leave a file behind', async () => {
  const mem = memoryStorage();
  const app = appHarness(serviceFor(mem.provider), [], { failCreate: true });
  await assert.rejects(() => app.documents.upload('project-a', 'PLAN', file(), 'org-a', 'user-1'), /database unavailable/);
  assert.equal(mem.files.size, 0);
});

test('document download: own organization gets the file; another organization gets "not found"', async () => {
  const mem = memoryStorage(); mem.files.set('project-a/1-plan.pdf', Buffer.from('secret du projet A'));
  const app = appHarness(serviceFor(mem.provider), [doc()]);
  const ok = await app.documents.download('doc-1', 'org-a');
  assert.equal(await body(ok), 'secret du projet A');
  assert.match(String(ok.getHeaders().disposition), /plan\.pdf/);
  await assert.rejects(() => app.documents.download('doc-1', 'org-b'), NotFoundException);
  await assert.rejects(() => app.documents.remove('doc-1', 'org-b', 'intruder'), NotFoundException);
  assert.equal(mem.files.size, 1, 'nothing was deleted by the other organization');
});

test('evidence download enforces the organization too', async () => {
  const mem = memoryStorage(); mem.files.set('project-a/evidence/2-photo.jpg', Buffer.from('photo'));
  const app = appHarness(serviceFor(mem.provider), [doc({ id: 'doc-evidence', name: 'photo.jpg', type: 'EVIDENCE', mimeType: 'image/jpeg', storageKey: 'project-a/evidence/2-photo.jpg' })]);
  assert.equal(await body(await app.evidence.download('evidence-1', 'org-a')), 'photo');
  await assert.rejects(() => app.evidence.download('evidence-1', 'org-b'), NotFoundException);
});

test('a missing stored file gives a clean "not found", for keys and for legacy paths', async () => {
  const app = appHarness(serviceFor(memoryStorage().provider), [doc(), doc({ id: 'doc-2', storageKey: 'C:\\old\\back\\uploads\\project-a\\9-gone.pdf' })]);
  await assert.rejects(() => app.documents.download('doc-1', 'org-a'), NotFoundException);
  await assert.rejects(() => app.documents.download('doc-2', 'org-a'), NotFoundException);
});

test('existing report download still works, including a record that still holds a legacy absolute path', async () => {
  const root = await tmpRoot();
  const storage = new StorageService(config({ STORAGE_LOCAL_DIR: root }));
  await new LocalStorage(root).put('project-a/reports/5-rapport.pdf', Buffer.from('%PDF rapport'));
  const legacy = path.join('C:\\ancien\\chemin\\back\\uploads', 'project-a', 'reports', '5-rapport.pdf');
  const app = appHarness(storage, [doc({ id: 'doc-report', name: 'rapport.pdf', type: 'CONTROL_REPORT', storageKey: legacy })], { reportDocumentId: 'doc-report' });
  const res = await app.reports.downloadFile('report-1', 'org-a');
  assert.equal(await body(res), '%PDF rapport');
  assert.equal(res.getHeaders().type, 'application/pdf');
  await assert.rejects(() => app.reports.downloadFile('report-1', 'org-b'), NotFoundException);
});

test('deleting a document removes its file', async () => {
  const mem = memoryStorage(); mem.files.set('project-a/1-plan.pdf', Buffer.from('x'));
  const docs = [doc()];
  const app = appHarness(serviceFor(mem.provider), docs);
  assert.deepEqual(await app.documents.remove('doc-1', 'org-a', 'user-1'), { deleted: true, fileRemoved: true });
  assert.equal(docs.length, 0);
  assert.equal(mem.files.size, 0);
  assert.equal(app.activity[0].action, 'Document supprimé');
});

test('a failed storage delete is reported and recorded, never silent', async () => {
  const mem = memoryStorage({ failDelete: true }); mem.files.set('project-a/1-plan.pdf', Buffer.from('x'));
  const docs = [doc()];
  const app = appHarness(serviceFor(mem.provider), docs);
  const result = await app.documents.remove('doc-1', 'org-a', 'user-1');
  assert.deepEqual(result, { deleted: true, fileRemoved: false });
  assert.equal(docs.length, 0, 'the record is gone, so nothing points to a missing file');
  assert.equal(app.activity[0].action, 'Document supprimé (fichier non effacé du stockage)');
  assert.equal(app.activity[0].metadata.fileRemoved, false);
});

test('the file of a control report cannot be deleted from the documents list', async () => {
  const mem = memoryStorage(); mem.files.set('k', Buffer.from('x'));
  const app = appHarness(serviceFor(mem.provider), [doc({ id: 'doc-report', type: 'CONTROL_REPORT', storageKey: 'k' })], { reportDocumentId: 'doc-report' });
  await assert.rejects(() => app.documents.remove('doc-report', 'org-a', 'user-1'), /rapport Bureau de Contrôle/);
  assert.equal(mem.files.size, 1);
});

test('deleting a project removes its files and reports the ones that could not be removed', async () => {
  const mem = memoryStorage(); const keys = ['project-a/1-plan.pdf', 'project-a/reports/2-r.pdf'];
  for (const k of keys) mem.files.set(k, Buffer.from('x')); mem.files.set('project-b/1-autre.pdf', Buffer.from('y'));
  const docs = [doc(), doc({ id: 'doc-2', storageKey: keys[1] }), doc({ id: 'doc-3', projectId: 'project-b', organizationId: 'org-b', storageKey: 'project-b/1-autre.pdf' })];
  const result: any = await appHarness(serviceFor(mem.provider), docs).projects.remove('project-a', 'org-a');
  assert.deepEqual([result.filesRemoved, result.filesOrphaned], [2, 0]);
  assert.deepEqual([...mem.files.keys()], ['project-b/1-autre.pdf'], 'another project is untouched');
  const failing = memoryStorage({ failDelete: true }); failing.files.set('project-a/1-plan.pdf', Buffer.from('x'));
  const failed: any = await appHarness(serviceFor(failing.provider), [doc()]).projects.remove('project-a', 'org-a');
  assert.deepEqual([failed.filesRemoved, failed.filesOrphaned], [0, 1]);
});

// ---------- one-off migration ----------

async function migrationSetup() {
  const root = await tmpRoot(); const source = new LocalStorage(root);
  await source.put('p1/reports/1-rapport.pdf', Buffer.from('rapport'));
  await source.put('p1/2-plan.pdf', Buffer.from('plan'));
  await source.put('p1/evidence/9-sans-fiche.jpg', Buffer.from('orphelin'));
  const rows = [
    { id: 'd1', name: 'rapport.pdf', mimeType: 'application/pdf', storageKey: path.join(root, 'p1', 'reports', '1-rapport.pdf').replace(/^.*?(?=[\\/]p1)/, 'C:\\old\\back\\uploads') },
    { id: 'd2', name: 'plan.pdf', mimeType: 'application/pdf', storageKey: 'p1/2-plan.pdf' },
    { id: 'd3', name: 'perdu.pdf', mimeType: 'application/pdf', storageKey: 'C:\\old\\back\\uploads\\p1\\3-perdu.pdf' },
    { id: 'd4', name: 'bizarre.pdf', mimeType: 'application/pdf', storageKey: 'C:\\ailleurs\\fichier.pdf' },
  ];
  const updates: any[] = [];
  const db: any = { document: { findMany: async () => rows.map(r => ({ ...r })), update: async ({ where, data }: any) => { updates.push({ id: where.id, ...data }); rows.find(r => r.id === where.id)!.storageKey = data.storageKey; } } };
  const target = memoryStorage();
  return { root, source, rows, updates, db, target };
}

test('migration dry run: reports the plan, uploads nothing, changes nothing', async () => {
  const s = await migrationSetup();
  const before = JSON.stringify(s.rows);
  const report = await migrateStoredFiles({ db: s.db, source: s.source, target: s.target.provider, localRoot: s.root, dryRun: true });
  assert.equal(report.dryRun, true);
  assert.deepEqual(report.items.map(i => i.outcome), ['migrated', 'migrated', 'missing', 'invalid-key']);
  assert.deepEqual(report.counts, { migrated: 2, 'already-migrated': 0, relinked: 0, missing: 1, 'invalid-key': 1, failed: 0 });
  assert.deepEqual(report.orphanedLocalFiles, ['p1/evidence/9-sans-fiche.jpg']);
  assert.equal(s.target.files.size, 0);
  assert.equal(s.target.calls.length, 0);
  assert.equal(s.updates.length, 0);
  assert.equal(JSON.stringify(s.rows), before);
});

test('migration: uploads, then updates the database; running it again changes nothing', async () => {
  const s = await migrationSetup();
  const first = await migrateStoredFiles({ db: s.db, source: s.source, target: s.target.provider, localRoot: s.root, dryRun: false });
  assert.deepEqual(first.counts, { migrated: 2, 'already-migrated': 0, relinked: 0, missing: 1, 'invalid-key': 1, failed: 0 });
  assert.deepEqual([...s.target.files.keys()].sort(), ['p1/2-plan.pdf', 'p1/reports/1-rapport.pdf']);
  assert.equal(s.target.files.get('p1/reports/1-rapport.pdf')!.toString(), 'rapport');
  assert.deepEqual(s.updates, [{ id: 'd1', storageKey: 'p1/reports/1-rapport.pdf' }], 'only the legacy path is rewritten, after its upload');
  assert.equal(await s.source.exists('p1/reports/1-rapport.pdf'), true, 'local files are kept');
  const callsAfterFirst = s.target.calls.length;
  const second = await migrateStoredFiles({ db: s.db, source: s.source, target: s.target.provider, localRoot: s.root, dryRun: false });
  assert.deepEqual(second.counts, { migrated: 0, 'already-migrated': 2, relinked: 0, missing: 1, 'invalid-key': 1, failed: 0 });
  assert.equal(s.target.calls.length, callsAfterFirst, 'no upload on the second run');
  assert.equal(s.updates.length, 1);
});

test('migration: the database is not updated when the upload fails', async () => {
  const s = await migrationSetup();
  const failing: StorageProvider = { ...s.target.provider, put: async () => { throw new Error('bucket unavailable'); } };
  const report = await migrateStoredFiles({ db: s.db, source: s.source, target: failing, localRoot: s.root, dryRun: false });
  assert.equal(report.counts.failed, 2);
  assert.equal(s.updates.length, 0);
  assert.ok(isLegacyPath(s.rows[0].storageKey), 'the record still points to the local file');
});

test('migration: an object already in the bucket is not uploaded again, the record is just relinked', async () => {
  const s = await migrationSetup();
  s.target.files.set('p1/reports/1-rapport.pdf', Buffer.from('rapport'));
  const report = await migrateStoredFiles({ db: s.db, source: s.source, target: s.target.provider, localRoot: s.root, dryRun: false });
  assert.equal(report.items[0].outcome, 'relinked');
  assert.ok(!s.target.calls.includes('put p1/reports/1-rapport.pdf'));
  assert.deepEqual(s.updates, [{ id: 'd1', storageKey: 'p1/reports/1-rapport.pdf' }]);
});
