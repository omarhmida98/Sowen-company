// Company portal / response loop tests. Run with: npm --workspace back test
// No database, storage or email provider is needed: they are replaced by in-memory fakes.
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PortalService } from '../src/portal/portal.service';
import { PortalController } from '../src/portal/portal.controller';
import { accessState, companyStatus, portalSecret, portalSecretRequired, portalToken, portalTtlDays, redactTokens, verifyPortalToken } from '../src/portal/portal-tokens';
import { validateEnvironment } from '../src/config.validation';
import { EvidenceService } from '../src/evidence/evidence.service';
import { EvidenceController } from '../src/evidence/evidence.controller';
import { ObservationsService } from '../src/observations/observations.service';
import { ObservationsController } from '../src/observations/observations.controller';
import { EmailsService } from '../src/emails/emails.service';
import { awaitingInternalReview, lastCompanyEngagement, reminderReason } from '../src/reminders/reminder-rules';
import { ROLES_KEY } from '../src/auth/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../src/auth/decorators/public.decorator';

type Row = Record<string, any>;
const ORG = 'org-1', OTHER_ORG = 'org-2', USER = 'user-admin';
// Two unrelated secrets: the one that signs portal links, and the JWT access secret.
const SECRET = 'portal-secret-for-tests-abcdefghijklmnop';
const JWT_SECRET = 'access-secret-for-tests-0123456789';
const JWT_REFRESH = 'refresh-secret-for-tests-9876543210';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DAY = 86400000;
const status = (code: number, message?: RegExp) => (e: any) => e.status === code && (!message || message.test(e.message));

// Two companies on project P1, company A also on project P2, and a company of another organisation.
function world(options: { env?: Record<string, string> } = {}) {
  let n = 100;
  const db = {
    companies: [{ id: 'A', name: 'ELEC Nord', email: 'a@example.com', organizationId: ORG }, { id: 'B', name: 'Plomberie Sud', email: 'b@example.com', organizationId: ORG }, { id: 'X', name: 'Étrangère', email: 'x@example.com', organizationId: OTHER_ORG }] as Row[],
    projects: [{ id: 'P1', name: 'Résidence Les Tilleuls', address: '12 rue des Lilas', organizationId: ORG }, { id: 'P2', name: 'École Jean Moulin', address: null, organizationId: ORG }, { id: 'PX', name: 'Projet étranger', address: null, organizationId: OTHER_ORG }] as Row[],
    projectLots: [{ id: 'pl1', projectId: 'P1', companyId: 'A' }, { id: 'pl2', projectId: 'P1', companyId: 'B' }, { id: 'pl3', projectId: 'P2', companyId: 'A' }, { id: 'pl4', projectId: 'PX', companyId: 'X' }] as Row[],
    observations: [
      { id: 'o-a1', projectId: 'P1', companyId: 'A', title: 'Différentiel manquant', description: 'Absence de différentiel 30 mA', requiredAction: 'Installer le dispositif', severity: 'HIGH', reference: 'NF C 15-100', dueDate: new Date(Date.now() + 5 * DAY), status: 'SENT', reviewStatus: 'VALIDATED', lotName: 'Électricité', aiConfidence: 0.9, escalationLevel: 2 },
      { id: 'o-b1', projectId: 'P1', companyId: 'B', title: 'Calorifugeage incomplet', description: 'Gaine technique', requiredAction: null, severity: 'MEDIUM', reference: null, dueDate: null, status: 'SENT', reviewStatus: null },
      { id: 'o-a2', projectId: 'P2', companyId: 'A', title: 'Éclairage de sécurité', description: 'Bloc manquant', requiredAction: null, severity: 'LOW', reference: null, dueDate: null, status: 'SENT', reviewStatus: null },
      { id: 'o-draft', projectId: 'P1', companyId: 'A', title: 'Pas encore envoyée', description: 'Brouillon interne', requiredAction: null, severity: 'LOW', reference: null, dueDate: null, status: 'OPEN', reviewStatus: 'PENDING' },
      { id: 'o-rejected', projectId: 'P1', companyId: 'A', title: 'Faux positif IA', description: 'Rejetée', requiredAction: null, severity: 'LOW', reference: null, dueDate: null, status: 'RESOLVED', reviewStatus: 'REJECTED' },
      { id: 'o-x1', projectId: 'PX', companyId: 'X', title: 'Autre organisation', description: 'Secret', requiredAction: null, severity: 'LOW', reference: null, dueDate: null, status: 'SENT', reviewStatus: null },
    ] as Row[],
    emails: [{ observationId: 'o-a1', sentAt: new Date(), status: 'SENT' }, { observationId: 'o-b1', sentAt: new Date(), status: 'SENT' }, { observationId: 'o-a2', sentAt: new Date(), status: 'SENT' }, { observationId: 'o-draft', sentAt: null, status: 'DRAFT' }, { observationId: 'o-rejected', sentAt: new Date(), status: 'SENT' }, { observationId: 'o-x1', sentAt: new Date(), status: 'SENT' }] as Row[],
    accesses: [] as Row[], responses: [] as Row[], evidence: [] as Row[], documents: [] as Row[], history: [] as Row[], activity: [] as Row[], files: new Map<string, Buffer>(),
    users: [{ id: USER, displayName: 'Alice Admin', email: 'admin@example.com' }] as Row[],
  };
  const env: Record<string, string> = { JWT_ACCESS_SECRET: JWT_SECRET, PORTAL_TOKEN_SECRET: SECRET, PUBLIC_APP_URL: 'https://app.sowen.example', ...options.env };
  const config = { get: (k: string) => env[k], getOrThrow: (k: string) => env[k] };
  const mailer = { publicAppUrl: () => env.PUBLIC_APP_URL || null, isConfigured: () => true };
  const storage = {
    save: async (i: Row) => { const key = `${i.projectId}/evidence/${++n}-${i.originalName}`; db.files.set(key, i.buffer); return key; },
    read: async (key: string) => { const b = db.files.get(key); if (!b) throw new Error('missing file'); return b; },
    remove: async (key: string) => db.files.delete(key),
  };
  const org = (o: Row) => db.projects.find(p => p.id === o.projectId)!.organizationId;
  // "Visible to the company": really sent, and not a rejected AI finding. Mirrors the VISIBLE filter of the service.
  const visible = (o: Row) => db.emails.some(e => e.observationId === o.id && e.sentAt && e.status !== 'ERROR') && o.reviewStatus !== 'REJECTED';
  const active = (a: Row) => !a.revokedAt && (!a.expiresAt || a.expiresAt > new Date());
  const matchObservation = (o: Row, where: Row = {}) =>
    (where.id === undefined || o.id === where.id) && (where.projectId === undefined || o.projectId === where.projectId) && (where.companyId === undefined || o.companyId === where.companyId)
    && (!where.project || org(o) === where.project.organizationId) && (!where.generatedEmails || visible(o));
  const withDoc = (e: Row) => ({ ...e, document: db.documents.find(d => d.id === e.documentId) || null });
  const prisma = {
    company: { findUnique: async ({ where }: any) => db.companies.find(c => c.id === where.id) || null },
    project: { findUnique: async ({ where }: any) => db.projects.find(p => p.id === where.id) || null, findFirst: async ({ where }: any) => db.projects.find(p => p.id === where.id && p.organizationId === where.organizationId) || null },
    projectLot: { findFirst: async ({ where }: any) => db.projectLots.find(l => l.projectId === where.projectId && l.companyId === where.companyId) || null },
    user: { findMany: async ({ where }: any) => db.users.filter(u => where.id.in.includes(u.id)) },
    companyPortalAccess: {
      create: async ({ data }: any) => { const row = { id: uuid(++n), createdAt: new Date(), revokedAt: null, revokedById: null, expiresAt: null, ...data }; db.accesses.push(row); return { ...row }; },
      findUnique: async ({ where }: any) => { const a = db.accesses.find(x => x.id === where.id); if (!a) return null; const project = db.projects.find(p => p.id === a.projectId)!; return { ...a, company: db.companies.find(c => c.id === a.companyId), project: { ...project, organization: { name: project.organizationId === ORG ? 'Atelier Nord' : 'Autre' } } }; },
      findFirst: async ({ where }: any) => { const rows = db.accesses.filter(a => a.projectId === where.projectId && a.companyId === where.companyId && active(a)).sort((x, y) => y.createdAt - x.createdAt); return rows[0] ? { ...rows[0] } : null; },
      findMany: async ({ where }: any) => db.accesses.filter(a => a.projectId === where.projectId && (!where.companyId || a.companyId === where.companyId)).sort((x, y) => y.createdAt - x.createdAt || (x.id < y.id ? 1 : -1)).map(a => ({ ...a, company: db.companies.find(c => c.id === a.companyId) })),
      update: async ({ where, data }: any) => ({ ...Object.assign(db.accesses.find(a => a.id === where.id)!, data) }),
      updateMany: async ({ where, data }: any) => { const rows = db.accesses.filter(a => a.projectId === where.projectId && a.companyId === where.companyId && (where.OR ? active(a) : !a.revokedAt)); rows.forEach(a => Object.assign(a, data)); return { count: rows.length }; },
    },
    observation: {
      findFirst: async ({ where, include }: any) => { const o = db.observations.find(x => matchObservation(x, where)); return o ? { ...o, ...(include?.evidence ? { evidence: db.evidence.filter(e => e.observationId === o.id) } : {}) } : null; },
      findUnique: async ({ where }: any) => { const o = db.observations.find(x => x.id === where.id); return o ? { ...o, project: db.projects.find(p => p.id === o.projectId) } : null; },
      findMany: async ({ where }: any) => db.observations.filter(o => matchObservation(o, where)).map(o => ({ ...o, lot: o.lotName ? { name: o.lotName } : null, responses: db.responses.filter(r => r.observationId === o.id && r.source === 'PORTAL'), evidence: db.evidence.filter(e => e.observationId === o.id && e.submittedByCompany && e.documentId).map(withDoc) })),
      update: async ({ where, data }: any) => ({ ...Object.assign(db.observations.find(o => o.id === where.id)!, data) }),
    },
    observationResponse: { create: async ({ data, select }: any) => { const row = { id: `resp-${++n}`, createdAt: new Date(), ...data }; db.responses.push(row); return select ? Object.fromEntries(Object.keys(select).map(k => [k, row[k]])) : { ...row }; } },
    document: { create: async ({ data }: any) => { const row = { id: `doc-${++n}`, ...data }; db.documents.push(row); return { ...row }; } },
    observationEvidence: {
      create: async ({ data }: any) => { const row = { id: `ev-${++n}`, createdAt: new Date(), reviewStatus: 'PENDING', reviewNote: null, reviewedAt: null, ...data }; db.evidence.push(row); return withDoc(row); },
      findFirst: async ({ where, include }: any) => {
        const e = db.evidence.find(x => x.id === where.id && (where.submittedByCompany === undefined || x.submittedByCompany === where.submittedByCompany) && (() => { const o = db.observations.find(y => y.id === x.observationId)!; return matchObservation(o, where.observation); })());
        return e ? { ...withDoc(e), ...(include?.observation ? { observation: { ...db.observations.find(o => o.id === e.observationId) } } : {}) } : null;
      },
      findMany: async ({ where }: any) => db.evidence.filter(e => e.observationId === where.observationId).map(withDoc),
      update: async ({ where, data }: any) => withDoc(Object.assign(db.evidence.find(e => e.id === where.id)!, data)),
    },
    observationHistory: { create: async ({ data }: any) => { db.history.push({ id: `h-${++n}`, createdAt: new Date(), ...data }); } },
    activityLog: { create: async ({ data }: any) => { db.activity.push(data); } },
  };
  const portal = new PortalService(prisma as any, storage as any, config as any, mailer as any);
  const evidence = new EvidenceService(prisma as any, storage as any);
  const observations = new ObservationsService(prisma as any);
  // get() of the observation service needs relations this fake does not model; the calls under test do not read its result.
  (observations as any).get = async (id: string) => ({ ...db.observations.find(o => o.id === id) });
  const tokenOf = (link: string) => link.split('/portal/')[1];
  const file = (name = 'attestation.pdf') => ({ originalname: name, buffer: Buffer.from(`content of ${name}`), mimetype: 'application/pdf', size: 20 }) as any;
  const open = async (companyId = 'A', projectId = 'P1') => { const a = await portal.create(companyId, projectId, undefined, ORG, USER); return { access: a, token: tokenOf(a.link!) }; };
  return { db, prisma, portal, evidence, observations, env, tokenOf, file, open, storage, config, mailer };
}
const obs = (w: ReturnType<typeof world>, id: string) => w.db.observations.find(o => o.id === id)!;

// ---------- tokens ----------

test('portal links are signed: nothing usable is stored, and a forged or altered link is refused', () => {
  const id = uuid(1), token = portalToken(id, SECRET);
  assert.equal(verifyPortalToken(token, SECRET), id);
  assert.match(token, /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/, 'access id + a 256-bit signature');
  assert.equal(verifyPortalToken(token, 'another-secret-0123456789abcdef'), null, 'signed with another secret');
  assert.equal(verifyPortalToken(`${uuid(2)}.${token.split('.')[1]}`, SECRET), null, 'signature of another access');
  assert.equal(verifyPortalToken(`${id}.${'A'.repeat(43)}`, SECRET), null);
  for (const bad of ['', id, `${id}.`, 'x.y', `${id}.${token.split('.')[1]}x`, null, 42, 'a'.repeat(500)]) assert.equal(verifyPortalToken(bad as any, SECRET), null, String(bad));
});

test('access state, company-facing status, validity and log redaction', () => {
  const now = new Date();
  assert.equal(accessState({ revokedAt: null, expiresAt: null }), 'ACTIVE');
  assert.equal(accessState({ revokedAt: null, expiresAt: new Date(now.getTime() + 1000) }), 'ACTIVE');
  assert.equal(accessState({ revokedAt: null, expiresAt: new Date(now.getTime() - 1000) }), 'EXPIRED');
  assert.equal(accessState({ revokedAt: now, expiresAt: null }), 'REVOKED');
  assert.deepEqual(['SENT', 'TO_RELAUNCH', 'WAITING', 'RESOLVED', 'BLOCKED'].map(companyStatus), ['ACTION_REQUIRED', 'ACTION_REQUIRED', 'UNDER_REVIEW', 'CLOSED', 'ACTION_REQUIRED']);
  assert.deepEqual([portalTtlDays(undefined), portalTtlDays(''), portalTtlDays('30'), portalTtlDays('0'), portalTtlDays('abc'), portalTtlDays('-5')], [90, 90, 30, 0, 90, 90]);
  const token = portalToken(uuid(1), SECRET);
  assert.equal(redactTokens(`/api/portal/${token}/response`), '/api/portal/[redacted]/response');
  assert.equal(redactTokens(`/api/portal/${token}/evidence/ev-1/file?x=1`), '/api/portal/[redacted]/evidence/ev-1/file?x=1');
  assert.equal(redactTokens(`/api/portal/${token}`), '/api/portal/[redacted]');
  assert.equal(redactTokens('/api/portal/access?projectId=P1'), '/api/portal/access?projectId=P1', 'the management route has no token');
  assert.equal(redactTokens('/api/portal/access/abc/regenerate'), '/api/portal/access/abc/regenerate');
  assert.equal(redactTokens('/api/emails/resolve/secret-token'), '/api/emails/resolve/[redacted]');
  assert.equal(redactTokens('/api/observations/123'), '/api/observations/123');
});

// ---------- the signing secret ----------

const GENERIC = '404 Ce lien est invalide, expiré ou révoqué.';
const answer = (w: ReturnType<typeof world>, token: string) => w.portal.get(token).then(() => '200', (e: any) => `${e.status} ${e.message}`);

test('secret selection: PORTAL_TOKEN_SECRET when set; none on a real installation without it; a development key locally', () => {
  assert.deepEqual(portalSecret({ PORTAL_TOKEN_SECRET: SECRET, JWT_ACCESS_SECRET: JWT_SECRET, NODE_ENV: 'production', PUBLIC_APP_URL: 'https://x' }), { secret: SECRET, source: 'configured' });
  assert.deepEqual(portalSecret({ PORTAL_TOKEN_SECRET: ` ${SECRET} `, JWT_ACCESS_SECRET: JWT_SECRET }), { secret: SECRET, source: 'configured' });
  // production, or a public address under which links are emailed: no fallback at all
  assert.equal(portalSecret({ JWT_ACCESS_SECRET: JWT_SECRET, NODE_ENV: 'production' }), null);
  assert.equal(portalSecret({ PORTAL_TOKEN_SECRET: '  ', JWT_ACCESS_SECRET: JWT_SECRET, NODE_ENV: 'Production' }), null);
  assert.equal(portalSecret({ JWT_ACCESS_SECRET: JWT_SECRET, PUBLIC_APP_URL: 'https://app.sowen.example' }), null);
  assert.deepEqual([portalSecretRequired({}), portalSecretRequired({ NODE_ENV: 'development' }), portalSecretRequired({ NODE_ENV: 'production' }), portalSecretRequired({ PUBLIC_APP_URL: 'https://x' })], [false, false, true, true]);
  // local development: a key derived from the JWT secret, never the JWT secret itself
  const dev = portalSecret({ JWT_ACCESS_SECRET: JWT_SECRET, NODE_ENV: 'development' })!;
  assert.equal(dev.source, 'development-fallback');
  assert.notEqual(dev.secret, JWT_SECRET);
  assert.equal(portalSecret({}), null);
});

test('start-up validation: the portal secret is required in production or with a public address, and must be a real separate secret', () => {
  const base = { DATABASE_URL: 'postgresql://x', JWT_ACCESS_SECRET: JWT_SECRET, JWT_REFRESH_SECRET: JWT_REFRESH };
  assert.ok(validateEnvironment({ ...base }), 'local development starts without it');
  assert.ok(validateEnvironment({ ...base, NODE_ENV: 'development', PORTAL_TOKEN_SECRET: '' }));
  assert.throws(() => validateEnvironment({ ...base, NODE_ENV: 'production' }), /PORTAL_TOKEN_SECRET must be configured/);
  assert.throws(() => validateEnvironment({ ...base, PUBLIC_APP_URL: 'https://app.sowen.example' }), /PORTAL_TOKEN_SECRET must be configured.*PUBLIC_APP_URL/);
  assert.ok(validateEnvironment({ ...base, NODE_ENV: 'production', PUBLIC_APP_URL: 'https://app.sowen.example', PORTAL_TOKEN_SECRET: SECRET }));
  assert.throws(() => validateEnvironment({ ...base, PORTAL_TOKEN_SECRET: 'too-short' }), /at least 24 characters/);
  assert.throws(() => validateEnvironment({ ...base, PORTAL_TOKEN_SECRET: JWT_SECRET }), /must be different from JWT_ACCESS_SECRET/);
  assert.throws(() => validateEnvironment({ ...base, PORTAL_TOKEN_SECRET: JWT_REFRESH }), /must be different/);
  // The error names the variable, never a value.
  try { validateEnvironment({ ...base, PORTAL_TOKEN_SECRET: JWT_SECRET }); } catch (e: any) { assert.equal(e.message.includes(JWT_SECRET), false); }
});

test('a valid portal link survives a rotation of the JWT access secret', async () => {
  const w = world();
  const { token } = await w.open();
  assert.equal(await answer(w, token), '200');
  w.env.JWT_ACCESS_SECRET = 'a-brand-new-jwt-access-secret-0123456789';
  w.env.JWT_REFRESH_SECRET = 'a-brand-new-jwt-refresh-secret-0123456789';
  assert.equal(await answer(w, token), '200', 'the link still opens the portal');
  assert.equal((await w.portal.addResponse(token, 'o-a1', 'Toujours joignable.')).message, 'Toujours joignable.');
  assert.equal(w.tokenOf((await w.portal.list('P1', 'A', ORG))[0].link!), token, 'and the link shown to the team is the same');
  // The portal signature owes nothing to the JWT secret.
  assert.equal(verifyPortalToken(token, JWT_SECRET), null);
  assert.equal(token.split('.')[1], portalToken(token.split('.')[0], SECRET).split('.')[1]);
});

test('changing PORTAL_TOKEN_SECRET invalidates the old signature; the access itself is kept and gets a new link', async () => {
  const w = world();
  const { access, token } = await w.open();
  w.env.PORTAL_TOKEN_SECRET = 'rotated-portal-secret-zyxwvutsrqponmlk';
  assert.equal(await answer(w, token), GENERIC, 'the old link is refused, with the generic answer');
  await assert.rejects(() => w.portal.addResponse(token, 'o-a1', 'x'), status(404));
  await assert.rejects(() => w.portal.downloadEvidence(token, 'ev-1'), status(404));
  const [row] = await w.portal.list('P1', 'A', ORG);
  assert.deepEqual({ id: row.id, state: row.state }, { id: access.id, state: 'ACTIVE' }, 'nothing was revoked or deleted');
  const renewed = w.tokenOf(row.link!);
  assert.notEqual(renewed, token);
  assert.equal(await answer(w, renewed), '200');
  // Going back to the previous secret makes the previous link valid again: validity depends only on the secret.
  w.env.PORTAL_TOKEN_SECRET = SECRET;
  assert.equal(await answer(w, token), '200');
  assert.equal(await answer(w, renewed), GENERIC);
});

test('forged signatures, revoked and expired accesses all get the same generic 404, whatever the secret in use', async () => {
  const environments: Record<string, string>[] = [{}, { PORTAL_TOKEN_SECRET: 'another-portal-secret-0123456789abcdef' }, { PORTAL_TOKEN_SECRET: '', PUBLIC_APP_URL: '', NODE_ENV: 'development' }];
  for (const env of environments) {
    const w = world({ env });
    const live = await w.open('A', 'P1'), revoked = await w.open('B', 'P1'), expired = await w.open('A', 'P2');
    await w.portal.revoke(revoked.access.id, ORG, USER);
    w.db.accesses.find(a => a.id === expired.access.id)!.expiresAt = new Date(Date.now() - 1000);
    const id = live.access.id, sig = live.token.split('.')[1];
    const forged = [
      `${id}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`,                    // one character changed
      `${id}.${portalToken(id, JWT_SECRET).split('.')[1]}`,                            // signed with the JWT secret
      `${id}.${portalToken(id, 'guessed-secret-0123456789abcdefgh').split('.')[1]}`,   // signed with a guessed secret
      `${revoked.access.id}.${sig}`,                                                  // a valid signature moved to another access
      portalToken(uuid(424242), w.env.PORTAL_TOKEN_SECRET || `sowen-portal-development:${JWT_SECRET}`), // well signed, unknown access
      id, `${id}.`, 'garbage',
    ];
    const answers = new Set<string>();
    for (const t of [...forged, revoked.token, expired.token]) answers.add(await answer(w, t));
    assert.deepEqual([...answers], [GENERIC], JSON.stringify(env));
    assert.equal(await answer(w, live.token), '200', 'while the live link works');
    // revoked and expired are still listed as such for the team
    assert.equal((await w.portal.list('P1', 'B', ORG))[0].state, 'REVOKED');
    assert.equal((await w.portal.list('P2', 'A', ORG))[0].state, 'EXPIRED');
  }
});

test('local development without PORTAL_TOKEN_SECRET works with the development key; production without it makes no link', async () => {
  const dev = world({ env: { PORTAL_TOKEN_SECRET: '', PUBLIC_APP_URL: '', WEB_URL: 'http://localhost:3000' } });
  const { token } = await dev.open();
  assert.equal(await answer(dev, token), '200');
  assert.equal(verifyPortalToken(token, JWT_SECRET), null, 'the development key is derived, it is not the JWT secret');
  // Defence in depth: if a production instance ever ran without the secret (it refuses to start), no link is made
  // or accepted, rather than falling back to another key.
  const prod = world({ env: { PORTAL_TOKEN_SECRET: '', NODE_ENV: 'production' } });
  const created = await prod.portal.create('A', 'P1', undefined, ORG, USER);
  assert.equal(created.link, null);
  assert.deepEqual(await prod.portal.emailLink('P1', 'A'), { cta: null, link: null });
  assert.equal(await answer(prod, token), GENERIC);
});

test('the portal secret and the signatures never reach the activity log, the history or a portal answer', async () => {
  const w = world();
  const { token } = await w.open();
  await w.portal.addResponse(token, 'o-a1', 'Bonjour');
  await w.portal.uploadEvidence(token, 'o-a1', 'PHOTO', undefined, w.file());
  const access = (await w.portal.list('P1', 'A', ORG))[0];
  await w.portal.regenerate(access.id, ORG, USER);
  const recorded = JSON.stringify([w.db.activity, w.db.history, w.db.accesses, w.db.responses, w.db.evidence, await w.portal.get(w.tokenOf((await w.portal.list('P1', 'A', ORG))[0].link!))]);
  for (const secret of [SECRET, JWT_SECRET, token.split('.')[1]]) assert.equal(recorded.includes(secret), false);
});

// ---------- scope of a link ----------

test('a valid portal link loads only the observations sent to that company on that project', async () => {
  const w = world();
  const { token } = await w.open('A', 'P1');
  const view = await w.portal.get(token);

  assert.deepEqual(view.access, { organization: 'Atelier Nord', project: { name: 'Résidence Les Tilleuls', address: '12 rue des Lilas' }, company: { name: 'ELEC Nord' }, expiresAt: view.access.expiresAt });
  assert.deepEqual(view.observations.map(o => o.id), ['o-a1'], 'not the other company, not the other project, not the unsent draft, not the rejected AI finding');
  const o = view.observations[0];
  assert.deepEqual(Object.keys(o).sort(), ['closedAt', 'description', 'dueDate', 'evidence', 'id', 'lot', 'reference', 'requiredAction', 'responses', 'severity', 'status', 'title']);
  assert.deepEqual({ title: o.title, requiredAction: o.requiredAction, severity: o.severity, reference: o.reference, lot: o.lot, status: o.status }, { title: 'Différentiel manquant', requiredAction: 'Installer le dispositif', severity: 'HIGH', reference: 'NF C 15-100', lot: 'Électricité', status: 'ACTION_REQUIRED' });
  const text = JSON.stringify(view);
  for (const leak of ['aiConfidence', 'escalationLevel', 'reviewStatus":"VALIDATED', 'storageKey', 'companyId', 'projectId', 'Plomberie Sud', 'Calorifugeage', 'Éclairage', 'Faux positif', 'Pas encore envoyée', token]) assert.equal(text.includes(leak), false, leak);
});

test('a revoked link is rejected immediately, on every portal route', async () => {
  const w = world();
  const { access, token } = await w.open();
  assert.equal((await w.portal.get(token)).observations.length, 1);
  await w.portal.revoke(access.id, ORG, USER);
  await assert.rejects(() => w.portal.get(token), status(404, /invalide, expiré ou révoqué/));
  await assert.rejects(() => w.portal.addResponse(token, 'o-a1', 'Bonjour'), status(404));
  await assert.rejects(() => w.portal.uploadEvidence(token, 'o-a1', 'PHOTO', undefined, w.file()), status(404));
  await assert.rejects(() => w.portal.downloadEvidence(token, 'ev-1'), status(404));
  assert.equal(w.db.responses.length + w.db.evidence.length, 0);
});

test('an expired link is rejected, with the same answer as an unknown or forged one', async () => {
  const w = world();
  const { access, token } = await w.open();
  w.db.accesses.find(a => a.id === access.id)!.expiresAt = new Date(Date.now() - 1000);
  const messages = new Set<string>();
  for (const t of [token, portalToken(uuid(999), SECRET), portalToken(access.id, 'wrong-secret-0123456789abcdef'), 'garbage', '']) await w.portal.get(t).catch((e: any) => messages.add(`${e.status} ${e.message}`));
  assert.deepEqual([...messages], ['404 Ce lien est invalide, expiré ou révoqué.']);
});

test('new accesses expire after PORTAL_ACCESS_TTL_DAYS; 0 means no expiry', async () => {
  const w = world();
  const { access } = await w.open();
  assert.ok(Math.abs(new Date(access.expiresAt!).getTime() - Date.now() - 90 * DAY) < 5000);
  assert.equal((await world({ env: { PORTAL_ACCESS_TTL_DAYS: '0' } }).open()).access.expiresAt, null);
  await assert.rejects(() => w.portal.create('A', 'P1', '2020-01-01', ORG, USER), status(400, /futur/));
});

test('an observation of another company or another project cannot be reached through the link', async () => {
  const w = world();
  const { token } = await w.open('A', 'P1');
  for (const foreign of ['o-b1', 'o-a2', 'o-x1', 'o-draft', 'o-rejected', 'does-not-exist']) {
    await assert.rejects(() => w.portal.addResponse(token, foreign, 'Je tente ma chance'), status(403, /pas accessible depuis ce portail/), foreign);
    await assert.rejects(() => w.portal.uploadEvidence(token, foreign, 'PHOTO', undefined, w.file()), status(403), foreign);
  }
  assert.equal(w.db.responses.length + w.db.evidence.length + w.db.documents.length + w.db.files.size, 0, 'nothing was written or stored');
  assert.ok(w.db.observations.filter(o => o.id !== 'o-rejected').every(o => ['SENT', 'OPEN'].includes(o.status)), 'no status changed');
  // The same company on its other project needs the link of that project.
  const p2 = await w.open('A', 'P2');
  assert.deepEqual((await w.portal.get(p2.token)).observations.map(o => o.id), ['o-a2']);
  await assert.rejects(() => w.portal.addResponse(p2.token, 'o-a1', 'x'), status(403));
});

// ---------- response and evidence ----------

test('the company submits a response: it is stored as is, marked as coming from the portal, and the observation waits for the team', async () => {
  const w = world();
  const { access, token } = await w.open();
  const before = { ...obs(w, 'o-a1') };
  const response = await w.portal.addResponse(token, 'o-a1', '  Intervention prévue lundi.  ');

  assert.deepEqual(Object.keys(response).sort(), ['createdAt', 'id', 'message']);
  const stored = w.db.responses[0];
  assert.deepEqual({ source: stored.source, message: stored.message, companyId: stored.companyId, portalAccessId: stored.portalAccessId, observationId: stored.observationId }, { source: 'PORTAL', message: 'Intervention prévue lundi.', companyId: 'A', portalAccessId: access.id, observationId: 'o-a1' });
  assert.equal(obs(w, 'o-a1').status, 'WAITING', 'Envoyé → En attente');
  assert.equal(obs(w, 'o-a1').description, before.description, 'the observation text is untouched');
  assert.equal(obs(w, 'o-a1').title, before.title);
  assert.deepEqual({ from: w.db.history[0].fromStatus, to: w.db.history[0].toStatus }, { from: 'SENT', to: 'WAITING' });
  assert.match(w.db.history[0].note, /Réponse de l’entreprise reçue via le portail \(ELEC Nord\)/);
  assert.match(w.db.activity.at(-1)!.action, /Réponse entreprise reçue via le portail/);
  assert.equal(JSON.stringify([w.db.history, w.db.activity]).includes(token), false, 'no token in history or activity');
  // The company sees its own response and the new status.
  const view = (await w.portal.get(token)).observations[0];
  assert.deepEqual({ status: view.status, messages: view.responses.map(r => r.message) }, { status: 'UNDER_REVIEW', messages: ['Intervention prévue lundi.'] });
  // A second response is added, never merged; the status stays.
  await w.portal.addResponse(token, 'o-a1', 'Complément : pièce commandée.');
  assert.equal(w.db.responses.length, 2);
  assert.equal(obs(w, 'o-a1').status, 'WAITING');
  await assert.rejects(() => w.portal.addResponse(token, 'o-a1', '   '), status(400));
  await assert.rejects(() => w.portal.addResponse(token, 'o-a1', 'x'.repeat(4001)), status(400, /trop long/));
});

test('a response recorded by the team is kept apart from portal responses and is not shown on the portal', async () => {
  const w = world();
  const { token } = await w.open();
  await w.observations.addResponse('o-a1', { message: 'Au téléphone : passage mardi.' } as any, ORG, USER);
  assert.deepEqual({ source: w.db.responses[0].source, userId: w.db.responses[0].userId }, { source: 'INTERNAL', userId: USER });
  assert.equal(obs(w, 'o-a1').status, 'WAITING');
  assert.equal((await w.portal.get(token)).observations[0].responses.length, 0, 'internal notes never reach the company');
  await assert.rejects(() => w.observations.addResponse('o-a1', { message: 'x' } as any, OTHER_ORG, 'intruder'), status(404));
});

test('the company uploads evidence, sees it and downloads its own file', async () => {
  const w = world();
  const { token } = await w.open();
  const uploaded = await w.portal.uploadEvidence(token, 'o-a1', 'CERTIFICATE', 'Attestation Consuel', w.file('consuel.pdf'));

  assert.deepEqual({ fileName: uploaded.fileName, type: uploaded.type, note: uploaded.note, reviewStatus: uploaded.reviewStatus }, { fileName: 'consuel.pdf', type: 'CERTIFICATE', note: 'Attestation Consuel', reviewStatus: 'PENDING' });
  assert.equal(JSON.stringify(uploaded).includes('storageKey'), false);
  assert.equal(w.db.evidence[0].submittedByCompany, true);
  assert.equal(obs(w, 'o-a1').status, 'WAITING');
  assert.match(w.db.history[0].note, /Justificatif reçu via le portail \(ELEC Nord\) : consuel\.pdf/);
  const second = await w.portal.uploadEvidence(token, 'o-a1', 'PHOTO', undefined, w.file('photo.jpg'));
  assert.deepEqual((await w.portal.get(token)).observations[0].evidence.map(e => e.fileName).sort(), ['consuel.pdf', 'photo.jpg'], 'several files can be attached');

  const stream = await w.portal.downloadEvidence(token, uploaded.id);
  assert.equal(stream.getHeaders().disposition, "attachment; filename*=UTF-8''consuel.pdf");
  assert.ok(second.id);
  await assert.rejects(() => w.portal.uploadEvidence(token, 'o-a1', 'MALWARE', undefined, w.file()), status(400, /Type de justificatif invalide/));
});

test('a company cannot download the evidence of another company, of another project, or added internally', async () => {
  const w = world();
  const a = await w.open('A', 'P1'), b = await w.open('B', 'P1'), a2 = await w.open('A', 'P2');
  const ofA = await w.portal.uploadEvidence(a.token, 'o-a1', 'PHOTO', undefined, w.file('a.jpg'));
  const ofB = await w.portal.uploadEvidence(b.token, 'o-b1', 'PHOTO', undefined, w.file('b.jpg'));
  const ofA2 = await w.portal.uploadEvidence(a2.token, 'o-a2', 'PHOTO', undefined, w.file('a2.jpg'));
  const internal = await w.evidence.upload('o-a1', 'PV', 'Note interne', w.file('interne.pdf'), ORG, USER);

  await assert.rejects(() => w.portal.downloadEvidence(a.token, ofB.id), status(404), 'another company');
  await assert.rejects(() => w.portal.downloadEvidence(b.token, ofA.id), status(404));
  await assert.rejects(() => w.portal.downloadEvidence(a.token, ofA2.id), status(404), 'same company, other project');
  await assert.rejects(() => w.portal.downloadEvidence(a.token, internal.id), status(404), 'a file the team added');
  assert.equal((await w.portal.get(a.token)).observations[0].evidence.some(e => e.fileName === 'interne.pdf'), false, 'internal evidence is not listed either');
  assert.ok(await w.portal.downloadEvidence(a.token, ofA.id));
});

// ---------- review ----------

test('an administrator or editor approves evidence: it is recorded in the history and does not close the observation', async () => {
  const w = world();
  const { token } = await w.open();
  const ev = await w.portal.uploadEvidence(token, 'o-a1', 'CERTIFICATE', undefined, w.file('consuel.pdf'));
  const reviewed = await w.evidence.review(ev.id, 'APPROVED' as any, undefined, ORG, USER);

  assert.deepEqual({ status: reviewed.reviewStatus, by: reviewed.reviewedById }, { status: 'APPROVED', by: USER });
  assert.ok(reviewed.reviewedAt instanceof Date);
  assert.equal(obs(w, 'o-a1').status, 'WAITING', 'approved, but still open');
  assert.equal(w.db.history.at(-1)!.note, 'Justificatif validé : consuel.pdf');
  assert.ok(w.db.activity.some(a => a.action === 'Preuve validée' && a.userId === USER));
  assert.equal((await w.portal.get(token)).observations[0].evidence[0].reviewStatus, 'APPROVED');
  assert.ok((await w.evidence.download(ev.id, ORG)), 'the team can open the company file');
  await assert.rejects(() => w.evidence.review(ev.id, 'APPROVED' as any, undefined, OTHER_ORG, 'intruder'), status(404), 'not from another organisation');
});

test('a refusal needs a reason; the reason is stored, shown to the company, and the observation goes back to follow-up', async () => {
  const w = world();
  const { token } = await w.open();
  const ev = await w.portal.uploadEvidence(token, 'o-a1', 'PHOTO', undefined, w.file('floue.jpg'));
  await assert.rejects(() => w.evidence.review(ev.id, 'REJECTED' as any, '   ', ORG, USER), status(400, /motif du refus/));
  assert.equal(w.db.evidence[0].reviewStatus, 'PENDING');

  await w.evidence.review(ev.id, 'REJECTED' as any, 'Photo illisible, merci de la refaire.', ORG, USER);
  assert.deepEqual({ status: w.db.evidence[0].reviewStatus, note: w.db.evidence[0].reviewNote }, { status: 'REJECTED', note: 'Photo illisible, merci de la refaire.' });
  assert.equal(obs(w, 'o-a1').status, 'TO_RELAUNCH');
  assert.equal(w.db.history.at(-1)!.note, 'Justificatif refusé : floue.jpg — Photo illisible, merci de la refaire.');
  const seen = (await w.portal.get(token)).observations[0];
  assert.deepEqual({ status: seen.status, review: seen.evidence[0].reviewStatus, why: seen.evidence[0].reviewNote }, { status: 'ACTION_REQUIRED', review: 'REJECTED', why: 'Photo illisible, merci de la refaire.' });
});

test('refused evidence can be replaced: the new proof is pending and the refused one is kept', async () => {
  const w = world();
  const { token } = await w.open();
  const first = await w.portal.uploadEvidence(token, 'o-a1', 'PHOTO', undefined, w.file('floue.jpg'));
  await w.evidence.review(first.id, 'REJECTED' as any, 'Illisible', ORG, USER);
  const replacement = await w.portal.uploadEvidence(token, 'o-a1', 'PHOTO', 'Nouvelle photo', w.file('nette.jpg'));

  assert.equal(obs(w, 'o-a1').status, 'WAITING', 'back to the team');
  const list = (await w.portal.get(token)).observations[0].evidence;
  assert.deepEqual(list.map(e => `${e.fileName}:${e.reviewStatus}`).sort(), ['floue.jpg:REJECTED', 'nette.jpg:PENDING']);
  await w.evidence.review(replacement.id, 'APPROVED' as any, undefined, ORG, USER);
  assert.deepEqual(w.db.evidence.map(e => e.reviewStatus), ['REJECTED', 'APPROVED']);
});

// ---------- closure ----------

test('only administrators and editors can review evidence, record a response, manage accesses or close; a consultant cannot', () => {
  const roles = (controller: any, method: string) => Reflect.getMetadata(ROLES_KEY, controller.prototype[method]);
  for (const [controller, method] of [[EvidenceController, 'review'], [EvidenceController, 'upload'], [ObservationsController, 'close'], [ObservationsController, 'addResponse'], [ObservationsController, 'transition'], [PortalController, 'list'], [PortalController, 'create'], [PortalController, 'regenerate'], [PortalController, 'revoke']] as const) {
    assert.deepEqual(roles(controller, method), ['ADMIN', 'EDITOR'], method);
    assert.equal(roles(controller, method).includes('USER'), false);
    assert.notEqual(Reflect.getMetadata(IS_PUBLIC_KEY, (controller as any).prototype[method]), true, `${method} is not public`);
  }
  // The only routes open without a session are the four token routes.
  assert.deepEqual(Object.getOwnPropertyNames(PortalController.prototype).filter(m => Reflect.getMetadata(IS_PUBLIC_KEY, (PortalController.prototype as any)[m])).sort(), ['download', 'get', 'response', 'uploadEvidence']);
});

test('closing requires an approved proof, or an explicit confirmation; pending proofs must be reviewed first', async () => {
  const w = world();
  const { token } = await w.open();
  // nothing approved, no confirmation
  await assert.rejects(() => w.observations.close('o-a1', {} as any, ORG, USER), status(400, /Confirmez la clôture sans justificatif/));
  // a proof waiting for a decision blocks the closure, even with the confirmation
  const ev = await w.portal.uploadEvidence(token, 'o-a1', 'CERTIFICATE', undefined, w.file('consuel.pdf'));
  await assert.rejects(() => w.observations.close('o-a1', { confirmWithoutProof: true } as any, ORG, USER), status(400, /1 justificatif\(s\) attendent encore votre décision/));
  assert.equal(obs(w, 'o-a1').status, 'WAITING');
  assert.equal(obs(w, 'o-a1').closedAt, undefined);
  // a plain status change cannot bypass the rule
  await assert.rejects(() => w.observations.transition('o-a1', { status: 'RESOLVED' } as any, ORG, USER), status(400, /Clôturer l’observation/));
  // another organisation cannot close it
  await assert.rejects(() => w.observations.close('o-a1', { confirmWithoutProof: true } as any, OTHER_ORG, 'intruder'), status(404));

  await w.evidence.review(ev.id, 'APPROVED' as any, undefined, ORG, USER);
  await w.observations.close('o-a1', { note: 'Vérifié sur site' } as any, ORG, USER);
  const closed = obs(w, 'o-a1');
  assert.deepEqual({ status: closed.status, by: closed.closedById, note: closed.closureNote }, { status: 'RESOLVED', by: USER, note: 'Vérifié sur site' });
  assert.ok(closed.closedAt instanceof Date);
  assert.equal(w.db.history.at(-1)!.note, 'Observation clôturée (1 justificatif(s) validé(s)) — Vérifié sur site');
  assert.ok(w.db.activity.some(a => a.action === 'Observation clôturée' && a.userId === USER && a.metadata.approvedEvidence === 1));
  await assert.rejects(() => w.observations.close('o-a1', {} as any, ORG, USER), status(400, /déjà clôturée/));
});

test('closing without proof is possible only with the confirmation, and is recorded as such', async () => {
  const w = world();
  await assert.rejects(() => w.observations.close('o-b1', { confirmWithoutProof: false } as any, ORG, USER), status(400));
  await w.observations.close('o-b1', { confirmWithoutProof: true } as any, ORG, USER);
  assert.equal(obs(w, 'o-b1').status, 'RESOLVED');
  assert.equal(w.db.history.at(-1)!.note, 'Observation clôturée sans justificatif');
  assert.equal(w.db.activity.at(-1)!.metadata.withoutProof, true);
  await assert.rejects(() => w.observations.close('o-rejected', { confirmWithoutProof: true } as any, ORG, USER), status(400, /rejetée/));
});

test('closure preserves every response, proof and history entry; the company sees it closed and can no longer write', async () => {
  const w = world();
  const { token } = await w.open();
  await w.portal.addResponse(token, 'o-a1', 'Travaux réalisés.');
  const refused = await w.portal.uploadEvidence(token, 'o-a1', 'PHOTO', undefined, w.file('floue.jpg'));
  await w.evidence.review(refused.id, 'REJECTED' as any, 'Illisible', ORG, USER);
  const ok = await w.portal.uploadEvidence(token, 'o-a1', 'PHOTO', undefined, w.file('nette.jpg'));
  await w.evidence.review(ok.id, 'APPROVED' as any, undefined, ORG, USER);
  const before = { responses: w.db.responses.length, evidence: w.db.evidence.length, documents: w.db.documents.length, files: w.db.files.size, history: w.db.history.length };

  await w.observations.close('o-a1', {} as any, ORG, USER);
  assert.deepEqual({ responses: w.db.responses.length, evidence: w.db.evidence.length, documents: w.db.documents.length, files: w.db.files.size, history: w.db.history.length }, { ...before, history: before.history + 1 });
  assert.deepEqual(w.db.evidence.map(e => `${e.reviewStatus}:${e.reviewNote}`), ['REJECTED:Illisible', 'APPROVED:null']);

  const view = (await w.portal.get(token)).observations[0];
  assert.equal(view.status, 'CLOSED');
  assert.ok(view.closedAt);
  assert.equal(view.responses.length, 1);
  assert.equal(view.evidence.length, 2);
  assert.ok(await w.portal.downloadEvidence(token, ok.id), 'files stay downloadable');
  await assert.rejects(() => w.portal.addResponse(token, 'o-a1', 'Encore moi'), status(400, /clôturée/));
  await assert.rejects(() => w.portal.uploadEvidence(token, 'o-a1', 'PHOTO', undefined, w.file()), status(400, /clôturée/));

  // Reopening forgets the closure itself, not the record.
  await w.observations.transition('o-a1', { status: 'OPEN' } as any, ORG, USER);
  const reopened = obs(w, 'o-a1');
  assert.deepEqual({ status: reopened.status, closedAt: reopened.closedAt, closedById: reopened.closedById }, { status: 'OPEN', closedAt: null, closedById: null });
  assert.equal(w.db.responses.length + w.db.evidence.length, 3);
  assert.ok(w.db.history.some(h => /Observation clôturée/.test(h.note)), 'the history still says it was closed');
});

// ---------- access management ----------

test('accesses are managed inside the organisation: list, one active access, regenerate, revoke, audit', async () => {
  const w = world();
  const first = await w.portal.create('A', 'P1', undefined, ORG, USER);
  assert.deepEqual({ state: first.state, company: first.company, createdBy: first.createdBy }, { state: 'ACTIVE', company: { id: 'A', name: 'ELEC Nord' }, createdBy: null });
  assert.ok(first.link!.startsWith('https://app.sowen.example/portal/'));
  assert.equal(JSON.stringify(w.db.accesses).includes(w.tokenOf(first.link!).split('.')[1]), false, 'the signature is not stored anywhere');

  const regenerated = await w.portal.regenerate(first.id, ORG, USER);
  assert.notEqual(regenerated.id, first.id);
  await assert.rejects(() => w.portal.get(w.tokenOf(first.link!)), status(404), 'the previous link stops working at once');
  assert.equal((await w.portal.get(w.tokenOf(regenerated.link!))).observations.length, 1);
  // Creating again while one is active replaces it: there is never more than one active access.
  const again = await w.portal.create('A', 'P1', undefined, ORG, USER);
  await assert.rejects(() => w.portal.get(w.tokenOf(regenerated.link!)), status(404));
  const list = await w.portal.list('P1', 'A', ORG);
  assert.deepEqual(list.map(a => a.state).sort(), ['ACTIVE', 'REVOKED', 'REVOKED']);
  assert.equal(list.filter(a => a.link).length, 1, 'only the active access has a link');
  assert.equal(list.find(a => a.state === 'ACTIVE')!.createdBy, 'Alice Admin');
  assert.ok(list.every(a => a.createdAt instanceof Date));

  const revoked = await w.portal.revoke(again.id, ORG, USER);
  assert.deepEqual({ state: revoked.state, link: revoked.link }, { state: 'REVOKED', link: null });
  assert.deepEqual(w.db.activity.map(a => a.action), ['Accès portail entreprise créé (ELEC Nord)', 'Accès portail entreprise régénéré (ELEC Nord)', 'Accès portail entreprise régénéré (ELEC Nord)', 'Accès portail entreprise révoqué (ELEC Nord)']);
  assert.ok(w.db.activity.every(a => a.userId === USER && a.entityType === 'CompanyPortalAccess'));
  assert.equal(JSON.stringify(w.db.activity).includes('/portal/'), false, 'no link in the activity log');
});

test('another organisation cannot create, list, regenerate or revoke an access; a company outside the project gets none', async () => {
  const w = world();
  const { access } = await w.open('A', 'P1');
  await assert.rejects(() => w.portal.create('A', 'P1', undefined, OTHER_ORG, 'intruder'), status(403));
  await assert.rejects(() => w.portal.create('X', 'P1', undefined, ORG, USER), status(403), 'a company of another organisation');
  await assert.rejects(() => w.portal.create('A', 'PX', undefined, ORG, USER), status(403), 'a project of another organisation');
  await assert.rejects(() => w.portal.list('P1', undefined, OTHER_ORG), status(404));
  await assert.rejects(() => w.portal.regenerate(access.id, OTHER_ORG, 'intruder'), status(403));
  await assert.rejects(() => w.portal.revoke(access.id, OTHER_ORG, 'intruder'), status(403));
  await assert.rejects(() => w.portal.create('B', 'P2', undefined, ORG, USER), status(403, /not assigned/), 'company B does not take part in project P2');
  assert.equal(w.db.accesses.length, 1);
  assert.equal(w.db.accesses[0].revokedAt, null);
});

// ---------- portal link in emails ----------

test('email link: a button on the public address, or no button and a link for the team when there is no public address', async () => {
  const w = world();
  // sending creates the access when the company has none
  const sent = await w.portal.emailLink('P1', 'A', { create: true, userId: USER });
  assert.equal(sent.cta!.label, 'Répondre dans SOWEN');
  assert.ok(sent.cta!.url.startsWith('https://app.sowen.example/portal/'));
  assert.equal((await w.portal.get(w.tokenOf(sent.cta!.url))).access.company.name, 'ELEC Nord', 'the link opens the portal of that company on that project');
  assert.equal(w.db.accesses.length, 1);
  assert.match(w.db.activity[0].action, /Accès portail entreprise créé \(envoi d’une observation\)/);
  // a reminder reuses the active access and never creates one
  assert.equal((await w.portal.emailLink('P1', 'A')).cta!.url, sent.cta!.url);
  assert.deepEqual(await w.portal.emailLink('P1', 'B'), { cta: null, link: null });
  assert.deepEqual(await w.portal.emailLink('P1', null, { create: true }), { cta: null, link: null });
  assert.equal(w.db.accesses.length, 1);

  // local development: PUBLIC_APP_URL missing
  const dev = world({ env: { PUBLIC_APP_URL: '', WEB_URL: 'http://localhost:3000' } });
  const local = await dev.portal.emailLink('P1', 'A', { create: true, userId: USER });
  assert.equal(local.cta, null, 'the email does not pretend to contain a link');
  assert.ok(local.link!.startsWith('http://localhost:3000/portal/'), 'the team can copy it');
  // production without a public address: no link at all
  const prod = world({ env: { PUBLIC_APP_URL: '', NODE_ENV: 'production' } });
  assert.deepEqual(await prod.portal.emailLink('P1', 'A', { create: true }), { cta: null, link: null });
});

test('the "point traité" link of an email records a company response; it no longer closes the observation', async () => {
  const w = world();
  const prisma: any = { ...w.prisma, generatedEmail: { findUnique: async () => ({ id: 'mail-1', projectId: 'P1', observationId: 'o-a1', observation: { ...obs(w, 'o-a1') } }), update: async ({ data }: any) => ({ id: 'mail-1', ...data }) } };
  await new EmailsService(prisma, w.mailer as any).resolve('some-token');
  assert.equal(obs(w, 'o-a1').status, 'WAITING');
  assert.equal(w.db.responses[0].source, 'PORTAL');
  assert.equal(obs(w, 'o-a1').closedAt, undefined);
});

// ---------- reminders ----------

const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const settings = { reminderDays: 7, sentReminderDays: 3 };
const sentMail = (days: number, extra: Row = {}) => ({ status: 'SENT', recipientEmail: 'a@example.com', sentAt: ago(days), lastRemindedAt: null, ...extra });

test('a company response stops the stale "Envoyé" reminders', () => {
  const silent = { status: 'SENT', dueDate: null, updatedAt: ago(10), generatedEmails: [sentMail(10)] };
  assert.equal(reminderReason(silent, NOW, settings), 'STALE_SENT', 'no response: followed up');
  // The portal moves the observation to "En attente" when the company answers…
  const answered = { ...silent, status: 'WAITING', updatedAt: ago(8), responses: [{ createdAt: ago(8) }] };
  assert.equal(reminderReason(answered, NOW, settings), null, '…and it is not chased, even after the "no news" delay');
  // …and the rule holds by itself if the status had not moved.
  assert.equal(reminderReason({ ...silent, responses: [{ createdAt: ago(1) }] }, NOW, settings), null);
});

test('an evidence upload counts as company engagement, including on an overdue observation', () => {
  const proof = { createdAt: ago(2), submittedByCompany: true, reviewStatus: 'PENDING', reviewedAt: null };
  const overdue = { status: 'WAITING', dueDate: ago(4), updatedAt: ago(2), generatedEmails: [sentMail(10)], evidence: [proof] };
  assert.equal(awaitingInternalReview(overdue), true);
  assert.equal(reminderReason(overdue, NOW, settings), null, 'the company has answered: the overdue reminder would be wrong');
  assert.equal(reminderReason({ ...overdue, evidence: [] }, NOW, settings), 'OVERDUE', 'without any answer the existing rule still applies');
  // Evidence the team added itself is not an answer from the company.
  assert.equal(reminderReason({ ...overdue, evidence: [{ ...proof, submittedByCompany: false }] }, NOW, settings), 'OVERDUE');
  assert.equal(lastCompanyEngagement({ ...overdue, responses: [{ createdAt: ago(1) }] })!.getTime(), ago(1).getTime());
  // An approved proof keeps it with the team (waiting for closure).
  assert.equal(reminderReason({ ...overdue, evidence: [{ ...proof, reviewStatus: 'APPROVED', reviewedAt: ago(1) }] }, NOW, settings), null);
});

test('refused evidence makes the observation eligible for follow-up again, until the company answers again', () => {
  const refused = { createdAt: ago(9), submittedByCompany: true, reviewStatus: 'REJECTED', reviewedAt: ago(8) };
  const o = { status: 'TO_RELAUNCH', dueDate: ago(1), updatedAt: ago(8), generatedEmails: [sentMail(12)], evidence: [refused] };
  assert.equal(awaitingInternalReview(o), false);
  assert.equal(reminderReason(o, NOW, settings), 'OVERDUE');
  const replaced = { ...o, status: 'WAITING', evidence: [refused, { createdAt: ago(1), submittedByCompany: true, reviewStatus: 'PENDING', reviewedAt: null }] };
  assert.equal(reminderReason(replaced, NOW, settings), null, 'a replacement proof puts it back with the team');
});

test('writing to the company again after its answer restarts the follow-up, and closed observations are never chased', () => {
  const o = { status: 'WAITING', dueDate: ago(2), updatedAt: ago(9), generatedEmails: [sentMail(12, { lastRemindedAt: ago(1) })], responses: [{ createdAt: ago(5) }] };
  assert.equal(awaitingInternalReview(o), false, 'the team replied after the response: the ball is with the company again');
  assert.equal(reminderReason(o, NOW, settings), 'OVERDUE');
  assert.equal(reminderReason({ ...o, status: 'RESOLVED' }, NOW, settings), null);
  // Observations without any response behave exactly as before.
  assert.equal(reminderReason({ status: 'WAITING', dueDate: null, updatedAt: ago(8), generatedEmails: [sentMail(12)] }, NOW, settings), 'STALE_WAITING');
  assert.equal(reminderReason({ status: 'SENT', dueDate: null, updatedAt: ago(1), generatedEmails: [sentMail(2)] }, NOW, settings), null);
});
