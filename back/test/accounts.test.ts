// Accounts & access tests: passwords, invitations, admin reset, rate limiting, sessions and roles.
// Run with: npm --workspace back test. No database or email provider is needed: Prisma, the mailer and the clock
// are replaced by in-memory fakes.
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../src/auth/auth.service';
import { AuthGuard } from '../src/auth/guards/auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { AuthRateLimit, counterKey, counters, rateLimitSettings, type Counter, type RateLimitStore } from '../src/auth/rate-limiter';
import { passwordProblem } from '../src/auth/password-policy';
import { accountLink, hashToken, isUsable, linkBase, linkTtlHours } from '../src/auth/account-links';
import { UsersService } from '../src/users/users.service';
import { UsersController } from '../src/users/users.controller';
import { ROLES_KEY } from '../src/auth/decorators/roles.decorator';
import { renderAccountEmail } from '../src/mailer/email-template';

// ---------- fakes ----------

type Row = Record<string, any>;
const ORG = 'org-1', OTHER_ORG = 'org-2';
const GOOD = 'Chantier-2026!', BETTER = 'Nouveau-Chantier-27';
// A low bcrypt cost keeps the tests fast; the services themselves always hash with cost 12.
const hash = (password: string) => bcrypt.hashSync(password, 4);

// Stands for the AuthRateLimit table: same rules as PrismaRateLimitStore (which is tested against PostgreSQL in
// rate-limit-db.test.ts), with a clock the tests can move. Two services given the same store behave like two API
// instances on the same database.
class TableStore implements RateLimitStore {
  rows = new Map<string, { count: number; resetAt: number }>();
  now: () => number = Date.now;
  async hit(keys: string[], windowMs: number): Promise<Counter[]> {
    return keys.map(key => {
      const row = this.rows.get(key);
      const next = row && row.resetAt > this.now() ? { count: row.count + 1, resetAt: row.resetAt } : { count: 1, resetAt: this.now() + windowMs };
      this.rows.set(key, next);
      return { key, count: next.count, retryMs: next.resetAt - this.now() };
    });
  }
  async release(keys: string[]) { for (const key of keys) { const row = this.rows.get(key); if (row && row.resetAt > this.now()) row.count = Math.max(0, row.count - 1); } }
  async clear(keys: string[]) { for (const key of keys) this.rows.delete(key); }
  async sweep() { let n = 0; for (const [key, row] of this.rows) if (row.resetAt <= this.now()) { this.rows.delete(key); n++; } return n; }
}

function world(options: { env?: Record<string, string>; mail?: 'ok' | 'off' | 'fail'; store?: TableStore } = {}) {
  let n = 0;
  const db = {
    organizations: [{ id: ORG, name: 'Atelier Nord' }, { id: OTHER_ORG, name: 'Autre Société' }] as Row[],
    users: [
      { id: 'admin', email: 'admin@example.com', displayName: 'Alice Admin', role: 'ADMIN', organizationId: ORG, passwordHash: hash(GOOD), tokenVersion: 0, passwordChangedAt: null },
      { id: 'editor', email: 'editor@example.com', displayName: 'Emile Editeur', role: 'EDITOR', organizationId: ORG, passwordHash: hash(GOOD), tokenVersion: 0, passwordChangedAt: null },
      { id: 'consultant', email: 'consultant@example.com', displayName: 'Chloé Consultante', role: 'USER', organizationId: ORG, passwordHash: hash(GOOD), tokenVersion: 0, passwordChangedAt: null },
      { id: 'foreign', email: 'foreign@example.com', displayName: 'Farid', role: 'USER', organizationId: OTHER_ORG, passwordHash: hash(GOOD), tokenVersion: 0, passwordChangedAt: null },
    ] as Row[],
    tokens: [] as Row[],
    activity: [] as Row[],
  };
  const outbox: Row[] = [];
  const env: Record<string, string> = { JWT_ACCESS_SECRET: 'access-secret-for-tests-0123456789', JWT_REFRESH_SECRET: 'refresh-secret-for-tests-9876543210', PUBLIC_APP_URL: 'https://app.sowen.example', ...options.env };
  const config = { get: (k: string) => env[k], getOrThrow: (k: string) => { if (!env[k]) throw new Error(`missing ${k}`); return env[k]; } };
  const withOrg = (u: Row) => ({ ...u, organization: db.organizations.find(o => o.id === u.organizationId) });
  const applyData = (row: Row, data: Row) => { for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === 'object' && 'increment' in (v as Row) ? row[k] + (v as Row).increment : v; return row; };
  const pick = (row: Row, select?: Row) => (select ? Object.fromEntries(Object.keys(select).filter(k => typeof select[k] === 'boolean').map(k => [k, row[k]])) : { ...row });
  const prisma = {
    user: {
      count: async () => db.users.length,
      findUnique: async ({ where, select, include }: any) => { const u = db.users.find(x => (where.id ? x.id === where.id : x.email === where.email)); if (!u) return null; return include?.organization ? withOrg(u) : pick(u, select); },
      findMany: async ({ where }: any) => db.users.filter(u => u.organizationId === where.organizationId).map(u => ({ ...u, tokens: db.tokens.filter(t => t.userId === u.id && !t.usedAt).sort((a, b) => b.createdAt - a.createdAt).slice(0, 1) })),
      create: async ({ data }: any) => { const u = { id: `user-${++n}`, tokenVersion: 0, passwordChangedAt: null, createdAt: new Date(), ...data }; db.users.push(u); return { ...u }; },
      update: async ({ where, data }: any) => ({ ...applyData(db.users.find(u => u.id === where.id)!, data) }),
      delete: async ({ where }: any) => { db.users = db.users.filter(u => u.id !== where.id); db.tokens = db.tokens.filter(t => t.userId !== where.id); },
    },
    userToken: {
      create: async ({ data }: any) => { const t = { id: `token-${++n}`, usedAt: null, createdAt: Date.now() + n, ...data }; db.tokens.push(t); return t; },
      findUnique: async ({ where }: any) => { const t = db.tokens.find(x => x.tokenHash === where.tokenHash); return t ? { ...t, user: withOrg(db.users.find(u => u.id === t.userId)!) } : null; },
      findFirst: async ({ where }: any) => db.tokens.filter(t => t.userId === where.userId && !t.usedAt).sort((a, b) => b.createdAt - a.createdAt)[0] || null,
      updateMany: async ({ where, data }: any) => { const t = db.tokens.find(x => x.id === where.id && !x.usedAt && x.expiresAt > new Date()); if (!t) return { count: 0 }; Object.assign(t, data); return { count: 1 }; },
      deleteMany: async ({ where }: any) => { const before = db.tokens.length; db.tokens = db.tokens.filter(t => !(t.userId === where.userId && (!('usedAt' in where) || !t.usedAt))); return { count: before - db.tokens.length }; },
    },
    organization: { findUnique: async ({ where }: any) => db.organizations.find(o => o.id === where.id) || null },
    activityLog: { create: async ({ data }: any) => { db.activity.push(data); } },
  };
  const mailer = {
    isConfigured: () => options.mail !== 'off',
    publicAppUrl: () => env.PUBLIC_APP_URL || null,
    send: async (mail: Row) => { if (options.mail === 'fail') throw new Error('smtp down'); outbox.push(mail); return { id: 'm1' }; },
  };
  const jwt = new JwtService({});
  const store = options.store ?? new TableStore();
  const limit = new AuthRateLimit(config as any, null as any);
  limit.store = store;
  const auth = new AuthService(prisma as any, jwt, config as any, limit);
  const users = new UsersService(prisma as any, mailer as any, config as any);
  (users as any).logger = { error() {}, log() {}, warn() {} };
  const guard = new AuthGuard(new Reflector(), jwt, config as any, prisma as any);
  // Runs the two global guards the way Nest does for a route restricted to `roles`.
  const request = async (accessToken: string, roles: string[] = []) => {
    const req: Row = { headers: { authorization: `Bearer ${accessToken}` } };
    const handler = () => {}; Reflect.defineMetadata(ROLES_KEY, roles, handler);
    const context: any = { getHandler: () => handler, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => req }) };
    await guard.canActivate(context);
    new RolesGuard(new Reflector()).canActivate(context);
    return req.user;
  };
  const tokenFromLink = (link: string) => link.split('/invitation/')[1];
  const linkIn = (mail: Row) => String(mail.text).match(/https?:\/\/\S+\/invitation\/[\w-]+/)![0];
  return { db, prisma, auth, users, outbox, env, request, tokenFromLink, linkIn, limit, store };
}
const status = (code: number, message?: RegExp) => (e: any) => e.status === code && (!message || message.test(e.message));

// ---------- password policy ----------

test('password policy: length, composition, common words and the email are checked', () => {
  assert.equal(passwordProblem(GOOD), null);
  assert.match(passwordProblem('court-1')!, /au moins 10 caractères/);
  assert.match(passwordProblem('1234567890123')!, /au moins une lettre/);
  assert.match(passwordProblem('seulementdeslettres')!, /un chiffre ou un symbole/);
  assert.match(passwordProblem('aaaaaaaaaa1')!, /trop simple/);
  assert.match(passwordProblem('Password2026')!, /trop courant/);
  assert.match(passwordProblem('jeanne.martin-2026', { email: 'jeanne.martin@example.com' })!, /adresse email/);
  assert.match(passwordProblem(`${'a1'.repeat(40)}`)!, /trop long/);
  assert.match(passwordProblem('')!, /obligatoire/);
});

// ---------- changing one's own password ----------

test('a user changes their own password: the new one works, the old one does not', async () => {
  const w = world();
  const session = await w.auth.login({ email: 'editor@example.com', password: GOOD }, '10.0.0.1');
  const changed: any = await w.auth.changePassword('editor', { currentPassword: GOOD, newPassword: BETTER, confirmPassword: BETTER }, '10.0.0.1');

  assert.ok(changed.accessToken && changed.refreshToken, 'the current session receives new tokens');
  assert.equal(JSON.stringify(changed).includes('passwordHash'), false, 'no hash in the answer');
  await assert.rejects(() => w.auth.login({ email: 'editor@example.com', password: GOOD }, '10.0.0.1'), status(401));
  assert.equal((await w.auth.login({ email: 'editor@example.com', password: BETTER }, '10.0.0.1')).user.id, 'editor');
  assert.ok(w.db.users.find(u => u.id === 'editor')!.passwordChangedAt instanceof Date);
  assert.ok(w.db.activity.some(a => a.action === 'Mot de passe modifié' && a.userId === 'editor'));

  // Sessions opened before the change are closed; the one that made the change continues.
  await assert.rejects(() => w.request(session.accessToken), status(401));
  await assert.rejects(() => w.auth.refresh({ refreshToken: session.refreshToken }, '10.0.0.1'), status(401));
  assert.equal((await w.request(changed.accessToken)).sub, 'editor');
});

test('a wrong current password is rejected and nothing changes', async () => {
  const w = world();
  await assert.rejects(() => w.auth.changePassword('editor', { currentPassword: 'pas-le-bon-1', newPassword: BETTER, confirmPassword: BETTER }, '10.0.0.1'), status(400, /actuel est incorrect/));
  assert.equal(w.db.users.find(u => u.id === 'editor')!.tokenVersion, 0);
  assert.equal((await w.auth.login({ email: 'editor@example.com', password: GOOD }, '10.0.0.1')).user.id, 'editor');
});

test('the new password must be confirmed, different and respect the policy', async () => {
  const w = world();
  const change = (newPassword: string, confirmPassword = newPassword) => w.auth.changePassword('editor', { currentPassword: GOOD, newPassword, confirmPassword }, '10.0.0.1');
  await assert.rejects(() => change(BETTER, 'Autre-chose-27'), status(400, /confirmation/));
  await assert.rejects(() => change(GOOD), status(400, /différent/));
  await assert.rejects(() => change('court-1'), status(400, /au moins 10/));
  assert.equal(w.db.users.find(u => u.id === 'editor')!.tokenVersion, 0);
});

// ---------- invitations ----------

test('an administrator invites a user without choosing a password; a branded email carries the link', async () => {
  const w = world();
  const result: any = await w.users.invite({ email: ' New.User@Example.com ', displayName: 'Nina Nouvelle', role: 'EDITOR' } as any, ORG, 'admin');

  const user = w.db.users.find(u => u.email === 'new.user@example.com')!;
  assert.equal(user.passwordHash, null, 'no password is set by the administrator');
  assert.equal(user.organizationId, ORG);
  assert.equal(result.delivery, 'EMAIL_SENT');
  assert.equal(result.link, undefined, 'the link is not shown when the email was sent');
  assert.equal(w.outbox.length, 1);
  const mail = w.outbox[0];
  assert.equal(mail.to, 'new.user@example.com');
  assert.match(mail.subject, /Invitation à rejoindre Atelier Nord sur SOWEN/);
  assert.match(mail.html, /Activer mon compte/);
  assert.match(mail.html, /Alice Admin/);
  assert.ok(w.linkIn(mail).startsWith('https://app.sowen.example/invitation/'));
  // Only the hash of the token is stored.
  const token = w.tokenFromLink(w.linkIn(mail));
  assert.equal(w.db.tokens.length, 1);
  assert.equal(w.db.tokens[0].tokenHash, hashToken(token));
  assert.equal(JSON.stringify(w.db.tokens).includes(token), false);
  assert.ok(w.db.activity.some(a => a.action === 'Utilisateur invité (new.user@example.com)' && a.userId === 'admin'));
  // Until the invitation is accepted the account cannot sign in, whatever the password tried.
  await assert.rejects(() => w.auth.login({ email: 'new.user@example.com', password: GOOD }, '10.0.0.1'), status(401, /Email ou mot de passe incorrect/));
  assert.equal((await w.users.list(ORG)).find(u => u.email === 'new.user@example.com')!.status, 'INVITED');
});

test('the invited user sets their own password and can sign in; the invitation works only once', async () => {
  const w = world();
  await w.users.invite({ email: 'nina@example.com', displayName: 'Nina', role: 'USER' } as any, ORG, 'admin');
  const token = w.tokenFromLink(w.linkIn(w.outbox[0]));

  const info = await w.auth.invitation(token, '10.0.0.9');
  assert.deepEqual({ type: info.type, email: info.email, organizationName: info.organizationName }, { type: 'INVITATION', email: 'nina@example.com', organizationName: 'Atelier Nord' });

  // A weak or unconfirmed password does not consume the invitation.
  await assert.rejects(() => w.auth.acceptInvitation({ token, password: 'court-1', confirmPassword: 'court-1' }, '10.0.0.9'), status(400));
  await assert.rejects(() => w.auth.acceptInvitation({ token, password: GOOD, confirmPassword: BETTER }, '10.0.0.9'), status(400, /confirmation/));

  const session: any = await w.auth.acceptInvitation({ token, password: GOOD, confirmPassword: GOOD }, '10.0.0.9');
  assert.equal(session.user.email, 'nina@example.com');
  assert.equal(session.user.role, 'USER');
  assert.equal((await w.request(session.accessToken)).organizationId, ORG);
  assert.equal((await w.auth.login({ email: 'nina@example.com', password: GOOD }, '10.0.0.9')).user.email, 'nina@example.com');
  assert.equal((await w.users.list(ORG)).find(u => u.email === 'nina@example.com')!.status, 'ACTIVE');

  // Second use of the same link: refused, for the lookup and for the acceptance.
  await assert.rejects(() => w.auth.invitation(token, '10.0.0.9'), status(404, /invalide ou a expiré/));
  await assert.rejects(() => w.auth.acceptInvitation({ token, password: BETTER, confirmPassword: BETTER }, '10.0.0.9'), status(404));
  assert.equal((await w.auth.login({ email: 'nina@example.com', password: GOOD }, '10.0.0.9')).user.email, 'nina@example.com', 'the password was not replaced');
});

test('an invitation expires', async () => {
  const w = world({ env: { INVITATION_TTL_HOURS: '48' } });
  await w.users.invite({ email: 'late@example.com', displayName: 'Late', role: 'USER' } as any, ORG, 'admin');
  const token = w.tokenFromLink(w.linkIn(w.outbox[0]));
  const row = w.db.tokens[0];
  assert.ok(Math.abs(row.expiresAt.getTime() - Date.now() - 48 * 3600000) < 5000, 'validity follows INVITATION_TTL_HOURS');
  assert.equal((await w.auth.invitation(token, '10.0.0.9')).email, 'late@example.com');

  row.expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(() => w.auth.invitation(token, '10.0.0.9'), status(404, /invalide ou a expiré/));
  await assert.rejects(() => w.auth.acceptInvitation({ token, password: GOOD, confirmPassword: GOOD }, '10.0.0.9'), status(404));
  assert.equal(w.db.users.find(u => u.email === 'late@example.com')!.passwordHash, null);
  const listed = (await w.users.list(ORG)).find(u => u.email === 'late@example.com')!;
  assert.deepEqual({ status: listed.status, expired: listed.linkExpired }, { status: 'INVITED', expired: true });
});

test('resending an invitation makes the previous link unusable', async () => {
  const w = world();
  const { user }: any = await w.users.invite({ email: 'nina@example.com', displayName: 'Nina', role: 'USER' } as any, ORG, 'admin');
  const first = w.tokenFromLink(w.linkIn(w.outbox[0]));
  await w.users.resendInvitation(user.id, ORG, 'admin');
  const second = w.tokenFromLink(w.linkIn(w.outbox[1]));
  assert.notEqual(first, second);
  await assert.rejects(() => w.auth.invitation(first, '10.0.0.9'), status(404));
  assert.equal((await w.auth.invitation(second, '10.0.0.9')).email, 'nina@example.com');
  await assert.rejects(() => w.users.resendInvitation('editor', ORG, 'admin'), status(400, /déjà actif/), 'an active account is not re-invited');
});

test('unknown, malformed and guessed links all get the same answer', async () => {
  const w = world();
  for (const token of ['', 'x', 'a'.repeat(43), '../../etc/passwd']) await assert.rejects(() => w.auth.invitation(token, '10.0.0.9'), status(404, /^Ce lien est invalide ou a expiré/), JSON.stringify(token));
});

test('without a public address (development) no email is sent and the administrator gets the link once', async () => {
  const w = world({ env: { PUBLIC_APP_URL: '', WEB_URL: 'http://localhost:3000' } });
  const result: any = await w.users.invite({ email: 'dev@example.com', displayName: 'Dev', role: 'USER' } as any, ORG, 'admin');
  assert.equal(result.delivery, 'LINK_ONLY');
  assert.ok(result.link.startsWith('http://localhost:3000/invitation/'));
  assert.match(result.reason, /aucun email n’a été envoyé/);
  assert.equal(w.outbox.length, 0);
  assert.equal((await w.auth.invitation(w.tokenFromLink(result.link), '10.0.0.9')).email, 'dev@example.com');
});

test('in production an invitation needs PUBLIC_APP_URL: nothing is created without it', async () => {
  const w = world({ env: { PUBLIC_APP_URL: '', NODE_ENV: 'production' } });
  await assert.rejects(() => w.users.invite({ email: 'prod@example.com', displayName: 'Prod', role: 'USER' } as any, ORG, 'admin'), status(400, /PUBLIC_APP_URL/));
  assert.equal(w.db.users.some(u => u.email === 'prod@example.com'), false);
  assert.equal(linkBase({ publicAppUrl: null, nodeEnv: 'production' }), null);
  assert.deepEqual(linkBase({ publicAppUrl: null, webUrl: 'http://localhost:3000, https://other' }), { base: 'http://localhost:3000', public: false });
});

test('when the email cannot be sent the administrator is told and receives the link instead', async () => {
  for (const mail of ['off', 'fail'] as const) {
    const w = world({ mail });
    const result: any = await w.users.invite({ email: 'nomail@example.com', displayName: 'No Mail', role: 'USER' } as any, ORG, 'admin');
    assert.equal(result.delivery, 'LINK_ONLY', mail);
    assert.ok(result.link.startsWith('https://app.sowen.example/invitation/'));
    assert.ok(result.reason);
    assert.equal(JSON.stringify(result).includes('smtp down'), false, 'the provider error is not exposed');
  }
});

test('an email already in use cannot be invited', async () => {
  const w = world();
  await assert.rejects(() => w.users.invite({ email: 'EDITOR@example.com', displayName: 'Twin', role: 'USER' } as any, ORG, 'admin'), status(400, /déjà utilisée/));
  assert.equal(w.outbox.length, 0);
});

test('account emails escape what users typed and state the validity', () => {
  const mail = renderAccountEmail({ type: 'INVITATION', subject: 'Invitation', recipientName: '<b>Nina</b>', organizationName: 'A & B <script>', senderName: 'Alice', url: 'https://app.sowen.example/invitation/abc', validHours: 72 });
  assert.equal(mail.html.includes('<script>'), false);
  assert.ok(mail.html.includes('&lt;b&gt;Nina&lt;/b&gt;'));
  assert.match(mail.html, /valable 3 jours et utilisable une seule fois/);
  assert.ok(mail.text.includes('https://app.sowen.example/invitation/abc'));
  const reset = renderAccountEmail({ type: 'PASSWORD_RESET', subject: 'x', url: 'https://app.sowen.example/invitation/abc', validHours: 24 });
  assert.match(reset.html, /Choisir un nouveau mot de passe/);
  assert.match(reset.html, /valable 24 heures/);
  assert.equal(linkTtlHours('PASSWORD_RESET', {}), 24);
  assert.equal(linkTtlHours('INVITATION', { INVITATION_TTL_HOURS: 'abc' }), 72);
  assert.equal(isUsable({ usedAt: new Date(), expiresAt: new Date(Date.now() + 1000) }), false);
  assert.equal(accountLink('https://x', 't'), 'https://x/invitation/t');
});

// ---------- administrator reset ----------

test('an administrator resets the password of a user of the same organisation', async () => {
  const w = world();
  const before = await w.auth.login({ email: 'editor@example.com', password: GOOD }, '10.0.0.1');
  const result: any = await w.users.resetPassword('editor', ORG, 'admin');

  assert.equal(result.delivery, 'EMAIL_SENT');
  assert.equal(JSON.stringify(result).includes('password'), false, 'no password of any kind is returned');
  assert.match(w.outbox[0].subject, /Réinitialisation de votre mot de passe SOWEN/);
  assert.ok(w.db.activity.some(a => a.action === 'Mot de passe réinitialisé par un administrateur (editor@example.com)' && a.userId === 'admin'));
  // The old password and the open sessions stop working at once.
  await assert.rejects(() => w.auth.login({ email: 'editor@example.com', password: GOOD }, '10.0.0.1'), status(401));
  await assert.rejects(() => w.request(before.accessToken), status(401));
  await assert.rejects(() => w.auth.refresh({ refreshToken: before.refreshToken }, '10.0.0.1'), status(401));
  assert.equal((await w.users.list(ORG)).find(u => u.id === 'editor')!.status, 'RESET_PENDING');

  // The user chooses the new password through the link; the role is unchanged.
  const token = w.tokenFromLink(w.linkIn(w.outbox[0]));
  assert.equal((await w.auth.invitation(token, '10.0.0.1')).type, 'PASSWORD_RESET');
  const session: any = await w.auth.acceptInvitation({ token, password: BETTER, confirmPassword: BETTER }, '10.0.0.1');
  assert.equal(session.user.role, 'EDITOR');
  assert.equal((await w.auth.login({ email: 'editor@example.com', password: BETTER }, '10.0.0.1')).user.id, 'editor');
});

test('only an administrator can reach the team routes: an editor or a consultant cannot reset, invite or remove', async () => {
  assert.deepEqual(Reflect.getMetadata(ROLES_KEY, UsersController), ['ADMIN']);
  for (const method of ['reset', 'invite', 'resend', 'remove', 'role', 'list']) assert.equal(Reflect.getMetadata(ROLES_KEY, (UsersController.prototype as any)[method]), undefined, `${method} keeps the class rule`);
  assert.deepEqual(Reflect.getMetadata(ROLES_KEY, UsersController.prototype.assignable), ['ADMIN', 'EDITOR']);

  const w = world();
  for (const email of ['editor@example.com', 'consultant@example.com']) {
    const session = await w.auth.login({ email, password: GOOD }, '10.0.0.1');
    await assert.rejects(() => w.request(session.accessToken, ['ADMIN']), status(403), email);
  }
  const admin = await w.auth.login({ email: 'admin@example.com', password: GOOD }, '10.0.0.1');
  assert.equal((await w.request(admin.accessToken, ['ADMIN'])).role, 'ADMIN');
});

test('an administrator cannot reset, re-invite, change or remove a user of another organisation', async () => {
  const w = world();
  await assert.rejects(() => w.users.resetPassword('foreign', ORG, 'admin'), status(403));
  await assert.rejects(() => w.users.resendInvitation('foreign', ORG, 'admin'), status(403));
  await assert.rejects(() => w.users.updateRole('foreign', 'ADMIN' as any, ORG, 'admin'), status(403));
  await assert.rejects(() => w.users.remove('foreign', ORG, 'admin'), status(403));
  const foreign = w.db.users.find(u => u.id === 'foreign')!;
  assert.deepEqual({ version: foreign.tokenVersion, role: foreign.role, hasPassword: Boolean(foreign.passwordHash) }, { version: 0, role: 'USER', hasPassword: true });
  assert.equal(w.outbox.length, 0);
  assert.equal((await w.users.list(ORG)).some(u => u.id === 'foreign'), false, 'and does not see them');
});

test('an administrator uses "change my password" for their own account, not the reset', async () => {
  const w = world();
  await assert.rejects(() => w.users.resetPassword('admin', ORG, 'admin'), status(400));
  assert.ok(w.db.users.find(u => u.id === 'admin')!.passwordHash);
});

test('the team list never contains a password hash', async () => {
  const w = world();
  const text = JSON.stringify([await w.users.list(ORG), await w.users.assignable(ORG), await w.auth.me('admin'), await w.auth.login({ email: 'admin@example.com', password: GOOD }, '10.0.0.1')]);
  assert.equal(text.includes('passwordHash'), false);
  assert.equal(text.includes('$2'), false);
});

// ---------- rate limiting ----------

const badLogin = (w: ReturnType<typeof world>, email = 'editor@example.com', ip = '10.0.0.5') => w.auth.login({ email, password: 'mauvais-mot-de-passe-1' }, ip).then(() => 201, (e: any) => e.status as number);

test('failed attempts persist when the backend restarts: a new service instance still refuses', async () => {
  const table = new TableStore();
  const before = world({ env: { AUTH_LOGIN_MAX_ATTEMPTS: '3' }, store: table });
  assert.deepEqual([await badLogin(before), await badLogin(before), await badLogin(before)], [401, 401, 401]);

  // "Restart": everything is rebuilt from scratch; only the table is the same.
  const after = world({ env: { AUTH_LOGIN_MAX_ATTEMPTS: '3' }, store: table });
  assert.notEqual(after.limit, before.limit);
  assert.equal(await badLogin(after), 429, 'the fourth attempt is refused although this instance saw none of the first three');
  await assert.rejects(() => after.auth.login({ email: 'editor@example.com', password: GOOD }, '10.0.0.5'), status(429, /Trop de tentatives/));
});

test('two backend instances share the same limit', async () => {
  const table = new TableStore();
  const a = world({ env: { AUTH_LOGIN_MAX_ATTEMPTS: '4' }, store: table }), b = world({ env: { AUTH_LOGIN_MAX_ATTEMPTS: '4' }, store: table });
  // The attacker's requests are spread over both instances: together they are allowed four attempts, not eight.
  assert.deepEqual([await badLogin(a), await badLogin(b), await badLogin(a), await badLogin(b), await badLogin(a), await badLogin(b)], [401, 401, 401, 401, 429, 429]);
  // A success on one instance clears the account for the other one too.
  const fresh = new TableStore();
  const c = world({ env: { AUTH_LOGIN_MAX_ATTEMPTS: '3' }, store: fresh }), d = world({ env: { AUTH_LOGIN_MAX_ATTEMPTS: '3' }, store: fresh });
  assert.deepEqual([await badLogin(c), await badLogin(d)], [401, 401]);
  await c.auth.login({ email: 'editor@example.com', password: GOOD }, '10.0.0.5');
  assert.deepEqual([await badLogin(d), await badLogin(d), await badLogin(d), await badLogin(d)], [401, 401, 401, 429]);
});

test('window expiry clears the block: the window starts at the first attempt and is never extended', async () => {
  const w = world({ env: { AUTH_LOGIN_MAX_ATTEMPTS: '3', AUTH_RATE_LIMIT_WINDOW_MINUTES: '15' } });
  let now = 1_000_000; w.store.now = () => now;
  assert.deepEqual([await badLogin(w), await badLogin(w), await badLogin(w), await badLogin(w)], [401, 401, 401, 429]);
  now += 15 * 60000 - 1000;
  // Hammering while blocked does not push the end of the block back.
  assert.equal(await badLogin(w), 429);
  await assert.rejects(() => w.auth.login({ email: 'editor@example.com', password: GOOD }, '10.0.0.5'), status(429, /Réessayez dans 1 minute\./));
  now += 1001;
  assert.equal((await w.auth.login({ email: 'editor@example.com', password: GOOD }, '10.0.0.5')).user.id, 'editor', 'the block ended by itself');
  assert.deepEqual([await badLogin(w), await badLogin(w), await badLogin(w), await badLogin(w)], [401, 401, 401, 429], 'and a new window counts from zero');
});

test('a successful login resets the failures of that account only, and gives the attempt back to the address', async () => {
  const w = world({ env: { AUTH_LOGIN_MAX_ATTEMPTS: '3', AUTH_IP_MAX_ATTEMPTS: '6' } });
  const secret = w.env.JWT_ACCESS_SECRET, settings = rateLimitSettings({ AUTH_LOGIN_MAX_ATTEMPTS: '3', AUTH_IP_MAX_ATTEMPTS: '6' });
  const keysOf = (account: string) => Object.fromEntries(counters('login', { ip: '10.0.0.5', account }, settings, secret).map((c, i) => [['pair', 'account', 'ip'][i], c.key]));
  const editor = keysOf('editor@example.com'), consultant = keysOf('consultant@example.com');
  const count = (key: string) => w.store.rows.get(key)?.count ?? 0;

  await badLogin(w); await badLogin(w); await badLogin(w, 'consultant@example.com');
  assert.deepEqual([count(editor.pair), count(editor.account), count(consultant.pair), count(editor.ip)], [2, 2, 1, 3]);

  await w.auth.login({ email: 'editor@example.com', password: GOOD }, '10.0.0.5');
  assert.deepEqual([count(editor.pair), count(editor.account)], [0, 0], 'the account counters of the user who signed in are cleared');
  assert.equal(count(consultant.pair), 1, 'another account keeps its failures');
  assert.equal(count(editor.ip), 3, 'the address keeps the three failures, without the successful attempt');
  // Successes never use up the per-address budget.
  for (let i = 0; i < 10; i++) await w.auth.login({ email: 'editor@example.com', password: GOOD }, '10.0.0.5');
  assert.equal(count(editor.ip), 3);
});

test('unknown and real accounts are counted and answered the same way, across instances', async () => {
  const table = new TableStore();
  const a = world({ env: { AUTH_LOGIN_MAX_ATTEMPTS: '2' }, store: table }), b = world({ env: { AUTH_LOGIN_MAX_ATTEMPTS: '2' }, store: table });
  const answers = async (email: string) => { const out: string[] = []; for (const w of [a, b, a, b]) await w.auth.login({ email, password: 'mauvais-mot-de-passe-1' }, '10.0.0.5').catch((e: any) => out.push(`${e.status} ${e.message}`)); return out; };
  const real = await answers('editor@example.com'), unknown = await answers('nobody@example.com');
  assert.deepEqual(real, unknown);
  assert.deepEqual(real.map(m => m.slice(0, 3)), ['401', '401', '429', '429']);
  // The same number of counters is written for both: the table does not reveal which accounts exist.
  const settings = rateLimitSettings({});
  for (const email of ['editor@example.com', 'nobody@example.com']) for (const c of counters('login', { ip: '10.0.0.5', account: email }, settings, a.env.JWT_ACCESS_SECRET)) assert.ok(table.rows.has(c.key), email);
});

test('expired limiter records are cleaned up; live ones are kept', async () => {
  const w = world({ env: { AUTH_LOGIN_MAX_ATTEMPTS: '3', AUTH_RATE_LIMIT_WINDOW_MINUTES: '15' } });
  let now = 1_000_000; w.store.now = () => now;
  await badLogin(w, 'editor@example.com', '10.0.0.5');
  now += 10 * 60000;
  await badLogin(w, 'consultant@example.com', '10.0.0.6');
  assert.equal(w.store.rows.size, 6);
  now += 6 * 60000; // the first window (16 min old) has ended, the second (6 min old) has not
  assert.equal(await w.limit.cleanup(), 3);
  assert.equal(w.store.rows.size, 3);
  assert.equal(await badLogin(w, 'consultant@example.com', '10.0.0.6'), 401);
  assert.equal(w.store.rows.get(counters('login', { ip: '10.0.0.6', account: 'consultant@example.com' }, rateLimitSettings({}), w.env.JWT_ACCESS_SECRET)[0].key)!.count, 2, 'a live counter survived the cleanup');
  now += 16 * 60000;
  assert.equal(await w.limit.cleanup(), 3);
  assert.equal(w.store.rows.size, 0, 'nothing is left once every window has ended');
  // A cleanup that fails (database unavailable) never breaks a sign-in.
  w.limit.store = { ...w.store, hit: w.store.hit.bind(w.store), release: w.store.release.bind(w.store), clear: w.store.clear.bind(w.store), sweep: async () => { throw new Error('db down'); } } as any;
  (w.limit as any).logger = { warn() {} };
  assert.equal(await w.limit.cleanup(), 0);
});

test('limiter records hold only a keyed hash: no email, address, password or token', async () => {
  const w = world();
  await badLogin(w, 'editor@example.com', '203.0.113.7');
  await w.auth.invitation('x'.repeat(43), '203.0.113.7').catch(() => {});
  const stored = JSON.stringify([...w.store.rows.entries()]);
  for (const secret of ['editor', 'example.com', '203.0.113.7', 'mauvais', 'xxxxxxxx']) assert.equal(stored.includes(secret), false, secret);
  for (const key of w.store.rows.keys()) assert.match(key, /^[0-9a-f]{64}$/);
  // The hash depends on the server secret: the same counter is found by every instance, and cannot be recomputed without it.
  assert.equal(counterKey('s1', 'ip|203.0.113.7'), counterKey('s1', 'ip|203.0.113.7'));
  assert.notEqual(counterKey('s1', 'ip|203.0.113.7'), counterKey('s2', 'ip|203.0.113.7'));
});

test('parallel attempts cannot slip past the limit: each one is counted before the password is checked', async () => {
  const w = world({ env: { AUTH_LOGIN_MAX_ATTEMPTS: '3' } });
  const codes = await Promise.all(Array.from({ length: 12 }, () => badLogin(w)));
  assert.equal(codes.filter(c => c === 401).length, 3);
  assert.equal(codes.filter(c => c === 429).length, 9);
});

test('rate limit settings come from the environment, with safe defaults', () => {
  assert.deepEqual(rateLimitSettings({}), { enabled: true, windowMs: 900000, perAccountAndIp: 5, perAccount: 20, perIp: 50 });
  assert.deepEqual(rateLimitSettings({ AUTH_RATE_LIMIT_ENABLED: 'false', AUTH_RATE_LIMIT_WINDOW_MINUTES: '1', AUTH_LOGIN_MAX_ATTEMPTS: '3', AUTH_ACCOUNT_MAX_ATTEMPTS: '6', AUTH_IP_MAX_ATTEMPTS: '9' }), { enabled: false, windowMs: 60000, perAccountAndIp: 3, perAccount: 6, perIp: 9 });
  assert.equal(rateLimitSettings({ AUTH_LOGIN_MAX_ATTEMPTS: '0' }).perAccountAndIp, 5, 'zero or invalid falls back to the default');
  assert.equal(rateLimitSettings({ AUTH_LOGIN_MAX_ATTEMPTS: 'abc' }).perAccountAndIp, 5);
});

test('login brute force: the limit triggers, with the same generic answer for a real and an unknown account', async () => {
  const w = world({ env: { AUTH_LOGIN_MAX_ATTEMPTS: '3' } });
  const messages: Record<string, string[]> = {};
  for (const email of ['editor@example.com', 'nobody@example.com']) {
    messages[email] = [];
    for (let i = 0; i < 4; i++) await w.auth.login({ email, password: 'mauvais-mot-de-passe-1' }, '10.0.0.5').catch((e: any) => messages[email].push(`${e.status} ${e.message}`));
  }
  assert.deepEqual(messages['editor@example.com'], messages['nobody@example.com'], 'nothing reveals which account exists');
  assert.deepEqual(messages['editor@example.com'].map(m => m.slice(0, 3)), ['401', '401', '401', '429']);
  assert.match(messages['editor@example.com'][3], /Trop de tentatives\. Réessayez dans 15 minutes\./);
  // Even the right password is refused while blocked, so guessing cannot continue.
  await assert.rejects(() => w.auth.login({ email: 'editor@example.com', password: GOOD }, '10.0.0.5'), status(429));
  // The legitimate user on another address is not locked out by that attacker.
  assert.equal((await w.auth.login({ email: 'editor@example.com', password: GOOD }, '192.168.1.20')).user.id, 'editor');
});

test('login limit: it eventually clears, and a success resets the counter', async () => {
  const w = world({ env: { AUTH_LOGIN_MAX_ATTEMPTS: '3', AUTH_RATE_LIMIT_WINDOW_MINUTES: '15' } });
  let now = Date.now();
  w.store.now = () => now;
  const bad = () => w.auth.login({ email: 'editor@example.com', password: 'mauvais-mot-de-passe-1' }, '10.0.0.5').catch((e: any) => e.status);
  assert.deepEqual([await bad(), await bad(), await bad(), await bad()], [401, 401, 401, 429]);
  now += 15 * 60000 + 1;
  assert.equal((await w.auth.login({ email: 'editor@example.com', password: GOOD }, '10.0.0.5')).user.id, 'editor', 'after the window the user signs in again');
  // Two failures, a success, then two failures: never blocked, the success cleared the count.
  assert.deepEqual([await bad(), await bad()], [401, 401]);
  await w.auth.login({ email: 'editor@example.com', password: GOOD }, '10.0.0.5');
  assert.deepEqual([await bad(), await bad()], [401, 401]);
  assert.equal((await w.auth.login({ email: 'editor@example.com', password: GOOD }, '10.0.0.5')).user.id, 'editor');
});

test('one address trying many accounts is limited, and so is one account attacked from many addresses', async () => {
  const perIp = world({ env: { AUTH_IP_MAX_ATTEMPTS: '4' } });
  const codes: number[] = [];
  for (let i = 0; i < 6; i++) await perIp.auth.login({ email: `victim${i}@example.com`, password: 'mauvais-mot-de-passe-1' }, '10.0.0.7').catch((e: any) => codes.push(e.status));
  assert.deepEqual(codes, [401, 401, 401, 401, 429, 429]);

  const perAccount = world({ env: { AUTH_ACCOUNT_MAX_ATTEMPTS: '4' } });
  const spread: number[] = [];
  for (let i = 0; i < 6; i++) await perAccount.auth.login({ email: 'editor@example.com', password: 'mauvais-mot-de-passe-1' }, `10.1.0.${i}`).catch((e: any) => spread.push(e.status));
  assert.deepEqual(spread, [401, 401, 401, 401, 429, 429]);
});

test('guessing invitation links and the current password is limited too', async () => {
  const w = world({ env: { AUTH_IP_MAX_ATTEMPTS: '3', AUTH_LOGIN_MAX_ATTEMPTS: '2' } });
  const links: number[] = [];
  for (let i = 0; i < 5; i++) await w.auth.invitation('x'.repeat(40) + i, '10.0.0.8').catch((e: any) => links.push(e.status));
  assert.deepEqual(links, [404, 404, 404, 429, 429]);

  const tries: number[] = [];
  for (let i = 0; i < 3; i++) await w.auth.changePassword('editor', { currentPassword: 'pas-le-bon-1', newPassword: BETTER, confirmPassword: BETTER }, '10.0.0.30').catch((e: any) => tries.push(e.status));
  assert.deepEqual(tries, [400, 400, 429]);
});

test('rate limiting can be switched off by configuration', async () => {
  const w = world({ env: { AUTH_RATE_LIMIT_ENABLED: 'false', AUTH_LOGIN_MAX_ATTEMPTS: '1' } });
  for (let i = 0; i < 4; i++) await assert.rejects(() => w.auth.login({ email: 'editor@example.com', password: 'mauvais-mot-de-passe-1' }, '10.0.0.5'), status(401));
});

// ---------- sessions, removal and roles ----------

test('a removed user loses access immediately, even with a token that has not expired', async () => {
  const w = world();
  const session = await w.auth.login({ email: 'editor@example.com', password: GOOD }, '10.0.0.1');
  assert.equal((await w.request(session.accessToken, ['ADMIN', 'EDITOR'])).sub, 'editor');

  await w.users.remove('editor', ORG, 'admin');
  await assert.rejects(() => w.request(session.accessToken), status(401));
  await assert.rejects(() => w.auth.refresh({ refreshToken: session.refreshToken }, '10.0.0.1'), status(401));
  await assert.rejects(() => w.auth.login({ email: 'editor@example.com', password: GOOD }, '10.0.0.1'), status(401));
  await assert.rejects(() => w.users.remove('admin', ORG, 'admin'), status(400), 'an administrator cannot remove themselves');
});

test('a role downgrade takes effect on the very next request, without a new sign-in', async () => {
  const w = world();
  const session = await w.auth.login({ email: 'editor@example.com', password: GOOD }, '10.0.0.1');
  assert.equal((await w.request(session.accessToken, ['ADMIN', 'EDITOR'])).role, 'EDITOR');

  await w.users.updateRole('editor', 'USER' as any, ORG, 'admin');
  // Same token, still valid, but the role is now read from the database.
  await assert.rejects(() => w.request(session.accessToken, ['ADMIN', 'EDITOR']), status(403));
  assert.equal((await w.request(session.accessToken)).role, 'USER', 'read access is kept');
  assert.equal((await w.auth.refresh({ refreshToken: session.refreshToken }, '10.0.0.1')).user.role, 'USER');

  // An upgrade applies just as fast.
  await w.users.updateRole('editor', 'ADMIN' as any, ORG, 'admin');
  assert.equal((await w.request(session.accessToken, ['ADMIN'])).role, 'ADMIN');
  await assert.rejects(() => w.users.updateRole('admin', 'USER' as any, ORG, 'admin'), status(400), 'an administrator cannot demote themselves');
});

test('tokens are still verified: a forged, malformed or wrong-kind token is refused', async () => {
  const w = world();
  const session = await w.auth.login({ email: 'admin@example.com', password: GOOD }, '10.0.0.1');
  const forged = await new JwtService({}).signAsync({ sub: 'admin', email: 'admin@example.com', role: 'ADMIN', organizationId: ORG, ver: 0 }, { secret: 'not-the-real-secret-0123456789' });
  await assert.rejects(() => w.request(forged), status(401));
  await assert.rejects(() => w.request('not-a-token'), status(401));
  await assert.rejects(() => w.request(session.refreshToken), status(401), 'a refresh token is not an access token');
  await assert.rejects(() => w.auth.refresh({ refreshToken: session.accessToken }, '10.0.0.1'), status(401), 'and the reverse');
  // The role claimed inside a token is ignored: only the database decides.
  const stale = await new JwtService({}).signAsync({ sub: 'consultant', email: 'consultant@example.com', role: 'ADMIN', organizationId: ORG, ver: 0 }, { secret: w.env.JWT_ACCESS_SECRET });
  await assert.rejects(() => w.request(stale, ['ADMIN']), status(403));
});

test('sessions opened before this version (no token version) keep working until a password change', async () => {
  const w = world();
  const legacy = await new JwtService({}).signAsync({ sub: 'editor', email: 'editor@example.com', role: 'EDITOR', organizationId: ORG }, { secret: w.env.JWT_ACCESS_SECRET });
  assert.equal((await w.request(legacy)).sub, 'editor');
  await w.auth.changePassword('editor', { currentPassword: GOOD, newPassword: BETTER, confirmPassword: BETTER }, '10.0.0.1');
  await assert.rejects(() => w.request(legacy), status(401));
});

test('registration applies the same password policy', async () => {
  const w = world({ env: { ALLOW_PUBLIC_REGISTRATION: 'true' } });
  (w.prisma as any).$transaction = async (fn: any) => fn({ organization: { create: async ({ data }: any) => ({ id: 'org-new', ...data }) }, user: w.prisma.user });
  await assert.rejects(() => w.auth.register({ email: 'first@example.com', password: 'password1', organizationName: 'X', displayName: 'First' }), status(400));
  const session: any = await w.auth.register({ email: 'first@example.com', password: GOOD, organizationName: 'X', displayName: 'First' });
  assert.equal(session.user.role, 'ADMIN');
});
