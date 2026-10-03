// Daily digest tests. Run with: npm --workspace back test
// No database or email provider is needed: Prisma and the mailer are replaced by in-memory fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CronTime } from 'cron';
import { DEFAULT_DIGEST_TIMEZONE, DIGEST_CRON, digestSlot, digestTimezone, isDigestDay, localDay } from '../src/notifications/digest-rules';
import { NotificationsService } from '../src/notifications/notifications.service';

const PARIS = 'Europe/Paris';
// 2026: Paris is UTC+1 in winter, UTC+2 from 29 March to 25 October.
const WED_8AM_WINTER = new Date('2026-01-14T07:00:00Z'); // Wednesday 08:00 Paris
const WED_8AM_SUMMER = new Date('2026-07-15T06:00:00Z'); // Wednesday 08:00 Paris
const SATURDAY = new Date('2026-07-18T06:00:00Z');
const SUNDAY = new Date('2026-07-19T06:00:00Z');
const NEXT_DAY = new Date('2026-07-16T06:00:00Z');       // Thursday 08:00 Paris

// ---------- configuration and calendar rules ----------

test('DAILY_DIGEST_TIMEZONE: Europe/Paris when missing, empty or unknown; a valid zone is used', () => {
  for (const raw of [undefined, null, '', '   ', 'Mars/Olympus', 'not a zone']) assert.equal(digestTimezone(raw), 'Europe/Paris', JSON.stringify(raw));
  assert.equal(DEFAULT_DIGEST_TIMEZONE, 'Europe/Paris');
  assert.equal(digestTimezone('America/Montreal'), 'America/Montreal');
  assert.equal(digestTimezone(' Africa/Tunis '), 'Africa/Tunis');
});

test('a weekday at 08:00 Paris time is a digest day, in winter and in summer', () => {
  assert.deepEqual(localDay(WED_8AM_WINTER, PARIS), { date: '2026-01-14', weekday: 3, hour: 8 });
  assert.deepEqual(localDay(WED_8AM_SUMMER, PARIS), { date: '2026-07-15', weekday: 3, hour: 8 });
  assert.equal(isDigestDay(WED_8AM_WINTER, PARIS), true);
  assert.equal(isDigestDay(WED_8AM_SUMMER, PARIS), true);
});

test('Saturday and Sunday are not digest days', () => {
  assert.equal(isDigestDay(SATURDAY, PARIS), false);
  assert.equal(isDigestDay(SUNDAY, PARIS), false);
});

test('the day is the local calendar day, not the UTC day', () => {
  // Friday 23:30 UTC is already Saturday 01:30 in Paris (summer): no digest.
  assert.equal(localDay(new Date('2026-07-17T23:30:00Z'), PARIS).date, '2026-07-18');
  assert.equal(isDigestDay(new Date('2026-07-17T23:30:00Z'), PARIS), false);
  // Sunday 22:30 UTC is Monday 00:30 in Paris: a digest day again.
  assert.equal(isDigestDay(new Date('2026-07-19T22:30:00Z'), PARIS), true);
  // The same instant falls on different days in different zones.
  assert.notEqual(digestSlot('u1', new Date('2026-07-15T23:30:00Z'), PARIS), digestSlot('u1', new Date('2026-07-15T23:30:00Z'), 'America/Montreal'));
});

test('DST-safe schedule: 08:00 local time on both sides of each clock change', () => {
  const next = (from: string) => new CronTime(DIGEST_CRON, PARIS).getNextDateFrom(new Date(from), PARIS).toUTC().toISO();
  // Clocks go forward on Sunday 29 March 2026: Friday is 07:00 UTC, the following Monday 06:00 UTC.
  assert.equal(next('2026-03-26T12:00:00Z'), '2026-03-27T07:00:00.000Z');
  assert.equal(next('2026-03-27T12:00:00Z'), '2026-03-30T06:00:00.000Z');
  // Clocks go back on Sunday 25 October 2026: Friday is 06:00 UTC, the following Monday 07:00 UTC.
  assert.equal(next('2026-10-22T12:00:00Z'), '2026-10-23T06:00:00.000Z');
  assert.equal(next('2026-10-23T12:00:00Z'), '2026-10-26T07:00:00.000Z');
  for (const iso of ['2026-03-27T07:00:00Z', '2026-03-30T06:00:00Z', '2026-10-23T06:00:00Z', '2026-10-26T07:00:00Z']) assert.equal(localDay(new Date(iso), PARIS).hour, 8, iso);
  assert.equal(DIGEST_CRON, '0 8 * * 1-5');
});

// ---------- service behaviour ----------

type User = { id: string; email: string; displayName: string; organizationId: string; role: string };
function harness(options: { unread?: Record<string, number>; env?: Record<string, string>; mailerConfigured?: boolean; failFor?: string[]; publicUrl?: string | null } = {}) {
  const users: User[] = [
    { id: 'admin', email: 'admin@example.com', displayName: 'Admin', organizationId: 'org-1', role: 'ADMIN' },
    { id: 'editor', email: 'editor@example.com', displayName: 'Éditeur', organizationId: 'org-1', role: 'EDITOR' },
    { id: 'reader', email: 'reader@example.com', displayName: 'Lecteur', organizationId: 'org-1', role: 'USER' },
  ];
  const unread = options.unread ?? { admin: 2, editor: 1, reader: 4 };
  const logs: any[] = []; const sent: any[] = []; let seq = 0;
  // Serialises transactions, as the advisory lock does for a given slot on the real database.
  let chain: Promise<unknown> = Promise.resolve();
  const prisma: any = {
    organization: { findUniqueOrThrow: async () => ({ dueSoonDays: 3 }), findMany: async () => [{ id: 'org-1' }] },
    observation: { findMany: async () => [] },
    generatedEmail: { findMany: async () => [] },
    observationEvidence: { findMany: async () => [] },
    user: { findMany: async ({ where }: any) => users.filter(u => !where.role || where.role.in.includes(u.role)) },
    notification: { findMany: async ({ where }: any) => Array.from({ length: unread[where.userId] ?? 0 }, (_, i) => ({ title: `Point ${i + 1}`, message: 'Détail' })) },
    activityLog: {
      findFirst: async ({ where }: any) => logs.find(l => l.entityType === where.entityType && l.entityId === where.entityId) || null,
      create: async ({ data }: any) => { const row = { id: `log-${++seq}`, ...data }; logs.push(row); return row; },
      delete: async ({ where }: any) => { const i = logs.findIndex(l => l.id === where.id); if (i >= 0) logs.splice(i, 1); },
    },
    $executeRaw: async () => 1,
    $transaction: (fn: any) => { const run = chain.then(async () => { await new Promise(r => setTimeout(r, 2)); return fn(prisma); }); chain = run.catch(() => {}); return run; },
  };
  const env = { DAILY_DIGEST_ENABLED: 'true', ...options.env };
  const config: any = { get: (key: string) => (env as Record<string, string>)[key] };
  const mailer: any = {
    isConfigured: () => options.mailerConfigured ?? true,
    publicAppUrl: () => options.publicUrl ?? null,
    send: async (mail: any) => { await new Promise(r => setTimeout(r, 5)); if ((options.failFor || []).includes(mail.to)) throw new Error('provider refused'); sent.push(mail); return { id: 'x' }; },
  };
  const scheduler: any = { addCronJob: () => {} };
  return { service: new NotificationsService(prisma, config, mailer, scheduler), sent, logs };
}

test('weekday at 08:00 Paris: admins and editors with unread notifications receive the digest', async () => {
  const { service, sent, logs } = harness();
  const result = await service.scheduledDigest(WED_8AM_SUMMER);
  assert.deepEqual(result, { ran: true, sent: 2 });
  assert.deepEqual(sent.map(m => m.to).sort(), ['admin@example.com', 'editor@example.com'], 'the read-only user is not a recipient');
  assert.equal(sent[0].subject, 'SOWEN · 2 point(s) à traiter');
  assert.equal(sent[0].automated, true);
  assert.ok(sent[0].html.includes('Synthèse quotidienne') && sent[0].html.includes('Bonjour Admin,') && sent[0].text.includes('- Point 1'), 'branded template with text fallback');
  assert.deepEqual(logs.map(l => l.entityId).sort(), ['admin:2026-07-15', 'editor:2026-07-15']);
});

test('weekend: the scheduled digest sends nothing', async () => {
  for (const day of [SATURDAY, SUNDAY]) {
    const { service, sent } = harness();
    assert.deepEqual(await service.scheduledDigest(day), { ran: false, reason: 'weekend' });
    assert.equal(sent.length, 0);
  }
});

test('DAILY_DIGEST_ENABLED=false: the scheduled digest sends nothing', async () => {
  const { service, sent } = harness({ env: { DAILY_DIGEST_ENABLED: 'false' } });
  assert.deepEqual(await service.scheduledDigest(WED_8AM_SUMMER), { ran: false, reason: 'disabled' });
  assert.equal(sent.length, 0);
});

test('same user, same day: no second digest (restart or second run)', async () => {
  const { service, sent } = harness();
  await service.scheduledDigest(WED_8AM_SUMMER);
  const again = await service.sendDigestForOrganization('org-1', new Date(WED_8AM_SUMMER.getTime() + 3 * 3600 * 1000));
  assert.equal(sent.length, 2);
  assert.deepEqual(again, { sent: 0, alreadySentToday: 2, nothingUnread: 0, failed: 0, configured: true });
});

test('a different day: eligible again', async () => {
  const { service, sent } = harness();
  await service.scheduledDigest(WED_8AM_SUMMER);
  const next = await service.scheduledDigest(NEXT_DAY);
  assert.deepEqual(next, { ran: true, sent: 2 });
  assert.equal(sent.length, 4);
});

test('a user with no unread notifications gets no email and uses no slot', async () => {
  const { service, sent, logs } = harness({ unread: { admin: 0, editor: 3 } });
  const result = await service.sendDigestForOrganization('org-1', WED_8AM_SUMMER);
  assert.deepEqual(result, { sent: 1, alreadySentToday: 0, nothingUnread: 1, failed: 0, configured: true });
  assert.deepEqual(sent.map(m => m.to), ['editor@example.com']);
  assert.deepEqual(logs.map(l => l.entityId), ['editor:2026-07-15']);
});

test('manual and scheduled triggers at the same moment: only one digest per user', async () => {
  const { service, sent, logs } = harness();
  const [scheduled, manual, second] = await Promise.all([
    service.scheduledDigest(WED_8AM_SUMMER),
    service.sendDigestForOrganization('org-1', WED_8AM_SUMMER),
    service.sendDigestForOrganization('org-1', WED_8AM_SUMMER),
  ]);
  assert.equal(sent.length, 2, 'two recipients, one email each');
  assert.deepEqual(sent.map(m => m.to).sort(), ['admin@example.com', 'editor@example.com']);
  assert.equal((scheduled as any).sent + manual.sent + second.sent, 2);
  assert.equal(manual.alreadySentToday + second.alreadySentToday + (2 - (scheduled as any).sent), 4);
  assert.equal(logs.length, 2);
});

test('the manual trigger works on a weekend but still respects one per day', async () => {
  const { service, sent } = harness();
  assert.equal((await service.sendDigestForOrganization('org-1', SATURDAY)).sent, 2);
  assert.equal((await service.sendDigestForOrganization('org-1', SATURDAY)).sent, 0);
  assert.equal(sent.length, 2);
});

test('a failed send frees the slot so the user can still receive the digest that day', async () => {
  const failing = harness({ failFor: ['admin@example.com'] });
  const first = await failing.service.sendDigestForOrganization('org-1', WED_8AM_SUMMER);
  assert.deepEqual(first, { sent: 1, alreadySentToday: 0, nothingUnread: 0, failed: 1, configured: true });
  assert.deepEqual(failing.logs.map(l => l.entityId), ['editor:2026-07-15'], 'no slot kept for the failed recipient');
});

test('"Ouvrir SOWEN" button only when PUBLIC_APP_URL is set', async () => {
  const without = harness();
  await without.service.sendDigestForOrganization('org-1', WED_8AM_SUMMER);
  assert.ok(!without.sent[0].html.includes('<a ') && !without.sent[0].html.includes('Ouvrir SOWEN') && !without.sent[0].text.includes('http'));
  const withUrl = harness({ publicUrl: 'https://app.example.com' });
  await withUrl.service.sendDigestForOrganization('org-1', WED_8AM_SUMMER);
  assert.ok(withUrl.sent[0].html.includes('href="https://app.example.com/"') && withUrl.sent[0].html.includes('Ouvrir SOWEN'));
  assert.ok(withUrl.sent[0].text.includes('Ouvrir SOWEN : https://app.example.com/'));
});

test('no email provider: nothing is sent and no slot is used', async () => {
  const { service, sent, logs } = harness({ mailerConfigured: false });
  const result = await service.sendDigestForOrganization('org-1', WED_8AM_SUMMER);
  assert.equal(result.configured, false);
  assert.equal(sent.length + logs.length, 0);
});
