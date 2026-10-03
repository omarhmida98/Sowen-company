// Reminder scan tests. Run with: npm --workspace back test
// No database or email provider is needed: Prisma and the mailer are replaced by in-memory fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SENT_REMINDER_DAYS, emailDecision, lastCompanyContact, reminderReason, reminderSettings, sendingWindow, sentReminderDays } from '../src/reminders/reminder-rules';
import { RemindersService } from '../src/reminders/reminders.service';

// The scan reads the real clock, so every date in these tests is relative to now.
const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 86400000);
const settings = { reminderDays: 7, sentReminderDays: 3 };
const sentEmail = (sentDaysAgo: number, extra: Record<string, unknown> = {}) => ({ id: `mail-${sentDaysAgo}`, status: 'SENT', recipientEmail: 'entreprise@example.com', subject: 'Observation', body: 'Texte', sentAt: daysAgo(sentDaysAgo), lastRemindedAt: null, reminderCount: 0, ...extra });
const observation = (extra: Record<string, unknown> = {}) => ({ id: 'obs-1', projectId: 'project-1', status: 'SENT', dueDate: null, updatedAt: daysAgo(0), escalationLevel: 0, title: 'Observation', reference: null, companyId: 'company-1', project: { name: 'Projet', organization: { name: 'Org' } }, company: { name: 'ELEC' }, generatedEmails: [sentEmail(4)], ...extra });

// ---------- configuration ----------

test('SENT_REMINDER_AFTER_DAYS: default when absent, empty or invalid', () => {
  for (const raw of [undefined, null, '', '   ', 'abc', '-2', 'NaN']) assert.equal(sentReminderDays(raw), DEFAULT_SENT_REMINDER_DAYS, `value ${JSON.stringify(raw)}`);
  assert.equal(DEFAULT_SENT_REMINDER_DAYS, 3);
});

test('SENT_REMINDER_AFTER_DAYS: configured value is used, 0 disables the rule', () => {
  assert.equal(sentReminderDays('5'), 5);
  assert.equal(sentReminderDays(' 10 '), 10);
  assert.equal(sentReminderDays('2.9'), 2);
  assert.equal(sentReminderDays('0'), 0);
});

// ---------- rule: which observations are picked ----------

test('Envoyé with no response becomes eligible only after the delay', () => {
  assert.equal(reminderReason(observation({ generatedEmails: [sentEmail(2)] }), NOW, settings), null, '2 days after sending: too early');
  assert.equal(reminderReason(observation({ generatedEmails: [sentEmail(4)] }), NOW, settings), 'STALE_SENT', '4 days after sending: eligible');
  assert.equal(reminderReason(observation({ generatedEmails: [sentEmail(4)] }), NOW, { ...settings, sentReminderDays: 10 }), null, 'longer configured delay');
  assert.equal(reminderReason(observation({ generatedEmails: [sentEmail(40)] }), NOW, { ...settings, sentReminderDays: 0 }), null, 'rule disabled');
});

test('a recent reminder restarts the delay, so reminders are not repeated too often', () => {
  const reminded = [sentEmail(10, { lastRemindedAt: daysAgo(1) })];
  assert.equal(lastCompanyContact(reminded)!.getTime(), daysAgo(1).getTime());
  assert.equal(reminderReason(observation({ generatedEmails: reminded }), NOW, settings), null);
  assert.equal(reminderReason(observation({ generatedEmails: [sentEmail(10, { lastRemindedAt: daysAgo(5) })] }), NOW, settings), 'STALE_SENT');
});

test('only emails that were really sent count: drafts and failed sends are ignored', () => {
  const draft = { status: 'DRAFT', recipientEmail: 'a@example.com', sentAt: null, lastRemindedAt: null };
  const failed = { status: 'ERROR', recipientEmail: 'a@example.com', sentAt: daysAgo(9), lastRemindedAt: null };
  assert.equal(lastCompanyContact([draft, failed]), null);
  assert.equal(reminderReason(observation({ generatedEmails: [draft, failed] }), NOW, settings), null);
});

test('the Envoyé rule applies to Envoyé only: a company response (En attente) or other statuses are untouched', () => {
  for (const status of ['OPEN', 'TO_SEND', 'WAITING', 'TO_RELAUNCH', 'BLOCKED', 'RESOLVED']) {
    assert.equal(reminderReason(observation({ status, generatedEmails: [sentEmail(30)] }), NOW, settings), null, status);
  }
});

test('existing rules are preserved: overdue and stale En attente', () => {
  assert.equal(reminderReason(observation({ status: 'OPEN', dueDate: daysAgo(1), generatedEmails: [] }), NOW, settings), 'OVERDUE');
  assert.equal(reminderReason(observation({ status: 'SENT', dueDate: daysAgo(1), generatedEmails: [sentEmail(1)] }), NOW, settings), 'OVERDUE', 'overdue wins over the Envoyé delay');
  assert.equal(reminderReason(observation({ status: 'RESOLVED', dueDate: daysAgo(9) }), NOW, settings), null, 'resolved is never reminded');
  assert.equal(reminderReason(observation({ status: 'WAITING', updatedAt: daysAgo(8), generatedEmails: [] }), NOW, settings), 'STALE_WAITING');
  assert.equal(reminderReason(observation({ status: 'WAITING', updatedAt: daysAgo(6), generatedEmails: [] }), NOW, settings), null);
  assert.equal(reminderReason(observation({ status: 'OPEN', dueDate: daysAhead(2), generatedEmails: [] }), NOW, settings), null);
});

// ---------- scan: what actually happens ----------

// In-memory stand-ins for Prisma and the mailer. Pass `shared` to give two service instances the same "database".
function createStore(rows: any[]) {
  const store = { rows, sentMails: [] as any[], history: [] as any[], activity: [] as any[], seq: 0, chain: Promise.resolve() as Promise<unknown>, sendDelayMs: 0, failSend: false };
  return store;
}
function harness(rows: any[], env: Record<string, string> = {}, mailerConfigured = true, shared?: ReturnType<typeof createStore>) {
  const store = shared || createStore(rows);
  const mails = () => store.rows.flatMap(r => r.generatedEmails);
  const matches = (row: any, where: any) => {
    if (where.entityType && row.entityType !== where.entityType) return false;
    if (typeof where.entityId === 'string' && row.entityId !== where.entityId) return false;
    if (typeof where.entityId === "object" && where.entityId?.startsWith && !String(row.entityId).startsWith(where.entityId.startsWith)) return false;
    if (typeof where.entityId === "object" && where.entityId?.in && !where.entityId.in.includes(row.entityId)) return false;
    if (typeof where.action === 'string' && row.action !== where.action) return false;
    if (typeof where.action === "object" && where.action?.in && !where.action.in.includes(row.action)) return false;
    if (where.createdAt?.gt && !(row.createdAt > where.createdAt.gt)) return false;
    if (where.createdAt?.lt && !(row.createdAt < where.createdAt.lt)) return false;
    return true;
  };
  const prisma: any = {
    organization: { findUnique: async () => ({ reminderDays: 7, escalationDays: 7 }), findMany: async () => [{ id: 'org-1', name: 'Org' }] },
    // Returns every row: the service must rely on reminderReason(), not on the query, to decide.
    // Copies are returned, as a real database would: updates only reach `rows` through update().
    observation: {
      findMany: async () => structuredClone(store.rows),
      update: async ({ where, data }: any) => Object.assign(store.rows.find(r => r.id === where.id), data),
    },
    observationHistory: { create: async ({ data }: any) => { store.history.push(data); } },
    activityLog: {
      create: async ({ data }: any) => { const row = { id: `log-${++store.seq}`, createdAt: new Date(), ...data }; store.activity.push(row); return row; },
      findFirst: async ({ where }: any) => store.activity.find(r => matches(r, where)) || null,
      update: async ({ where, data }: any) => Object.assign(store.activity.find(r => r.id === where.id), data),
      delete: async ({ where }: any) => { const i = store.activity.findIndex(r => r.id === where.id); if (i >= 0) store.activity.splice(i, 1); },
      deleteMany: async ({ where }: any) => { for (let i = store.activity.length - 1; i >= 0; i--) if (matches(store.activity[i], where)) store.activity.splice(i, 1); },
      groupBy: async ({ where }: any) => { const counts = new Map<string, number>(); for (const r of store.activity.filter(x => matches(x, where))) counts.set(r.entityId, (counts.get(r.entityId) || 0) + 1); return [...counts].map(([entityId, n]) => ({ entityId, _count: { _all: n } })); },
    },
    generatedEmail: {
      // The cooldown test and the write happen together, like the single UPDATE ... WHERE of the real database.
      updateMany: async ({ where, data }: any) => { const mail = mails().find((m: any) => m.id === where.id); const limit = where.OR[1].lastRemindedAt.lt; if (mail.lastRemindedAt && !(mail.lastRemindedAt < limit)) return { count: 0 }; mail.lastRemindedAt = data.lastRemindedAt; mail.reminderCount += 1; return { count: 1 }; },
      update: async ({ where, data }: any) => { const mail = mails().find((m: any) => m.id === where.id); mail.lastRemindedAt = data.lastRemindedAt; if (data.reminderCount?.decrement) mail.reminderCount -= data.reminderCount.decrement; },
    },
    companyPortalAccess: { findFirst: async () => null },
    $executeRaw: async () => 1,
    // Serialises transactions, as the advisory lock does on the real database.
    $transaction: (fn: any) => { const run = store.chain.then(() => fn(prisma)); store.chain = run.catch(() => {}); return run; },
  };
  const config: any = { get: (key: string) => env[key] };
  const mailer: any = { isConfigured: () => mailerConfigured, publicAppUrl: () => null, send: async (mail: any) => { if (store.sendDelayMs) await new Promise(r => setTimeout(r, store.sendDelayMs)); if (store.failSend) throw new Error('provider refused'); store.sentMails.push(mail); return { id: 'fake' }; } };
  return { service: new RemindersService(prisma, config, mailer), sentMails: store.sentMails, history: store.history, activity: store.activity, store };
}

test('scan: a stale Envoyé observation is flagged "À relancer" and reminded once, never moved to En attente', async () => {
  const row = observation({ generatedEmails: [sentEmail(4), { id: 'draft', status: 'DRAFT', recipientEmail: 'entreprise@example.com', subject: 'Brouillon', body: 'x', sentAt: null, lastRemindedAt: null, reminderCount: 0 }] });
  const { service, sentMails, history } = harness([row]);
  const result = await service.scan('org-1', 'user-1');
  assert.equal(result.markedForReminder, 1);
  assert.equal(result.emailsSent, 1);
  assert.equal(result.sentReminderAfterDays, 3);
  assert.equal(row.status, 'TO_RELAUNCH');
  assert.notEqual(row.status, 'WAITING');
  assert.equal(sentMails.length, 1, 'only the email that was sent is reminded, not the unsent draft');
  assert.equal(sentMails[0].to, 'entreprise@example.com');
  assert.equal(sentMails[0].subject, 'Relance - Observation', 'a reminder never reuses the original subject unchanged');
  assert.equal(history[0].fromStatus, 'SENT');
  assert.equal(history[0].toStatus, 'TO_RELAUNCH');
  assert.match(history[0].note, /Aucune réponse de l’entreprise 3 jour/);
});

test('scan: running again right after does not send a second reminder', async () => {
  const row = observation();
  const { service, sentMails } = harness([row]);
  await service.scan('org-1');
  const again = await service.scan('org-1');
  assert.equal(sentMails.length, 1);
  assert.equal(again.emailsSent, 0);
  assert.equal(again.markedForReminder, 0);
});

test('scan: a recently sent Envoyé observation is left alone', async () => {
  const row = observation({ generatedEmails: [sentEmail(1)] });
  const { service, sentMails } = harness([row]);
  const result = await service.scan('org-1');
  assert.equal(result.checked, 0);
  assert.equal(row.status, 'SENT');
  assert.equal(sentMails.length, 0);
});

test('scan: the delay comes from SENT_REMINDER_AFTER_DAYS', async () => {
  const late = harness([observation({ generatedEmails: [sentEmail(4)] })], { SENT_REMINDER_AFTER_DAYS: '10' });
  assert.equal((await late.service.scan('org-1')).emailsSent, 0);
  const early = harness([observation({ generatedEmails: [sentEmail(2)] })], { SENT_REMINDER_AFTER_DAYS: '1' });
  assert.equal((await early.service.scan('org-1')).emailsSent, 1);
  const off = harness([observation({ generatedEmails: [sentEmail(60)] })], { SENT_REMINDER_AFTER_DAYS: '0' });
  assert.equal((await off.service.scan('org-1')).checked, 0);
});

test('scan: without an email provider the observation is flagged but nothing is sent', async () => {
  const row = observation();
  const { service, sentMails } = harness([row], {}, false);
  const result = await service.scan('org-1');
  assert.equal(row.status, 'TO_RELAUNCH');
  assert.equal(result.emailsSent, 0);
  assert.equal(result.emailConfigured, false);
  assert.equal(sentMails.length, 0);
});

test('scan: overdue escalation and the 24-hour reminder cooldown still work', async () => {
  const overdue = observation({ id: 'obs-overdue', status: 'WAITING', dueDate: daysAgo(15), generatedEmails: [sentEmail(20, { id: 'mail-overdue' })] });
  const cooling = observation({ id: 'obs-cooling', status: 'TO_RELAUNCH', dueDate: daysAgo(2), generatedEmails: [sentEmail(9, { id: 'mail-cooling', lastRemindedAt: new Date(Date.now() - 3600 * 1000) })] });
  const { service, sentMails, activity } = harness([overdue, cooling]);
  const result = await service.scan('org-1');
  assert.equal(overdue.status, 'TO_RELAUNCH');
  assert.equal(overdue.escalationLevel, 3, '15 days overdue with 7-day steps is capped at level 3');
  assert.equal(result.escalated, 2);
  assert.equal(sentMails.length, 1, 'the email reminded an hour ago is skipped');
  assert.match(sentMails[0].subject, /^Relance urgente - /);
  assert.equal(sentMails[0].automated, true, 'scan reminders are marked as automated mail');
  assert.ok(activity.some(a => a.action === 'Escalade niveau 3'));
});

// ---------- automatic sending: settings, window, per-email decision ----------

const PARIS_WED_10 = new Date('2026-07-15T08:00:00Z');   // Wednesday 10:00 in Paris (summer, UTC+2)
const PARIS_WED_03 = new Date('2026-07-15T01:00:00Z');   // Wednesday 03:00 in Paris
const PARIS_WED_19 = new Date('2026-07-15T17:30:00Z');   // Wednesday 19:30 in Paris
const PARIS_SAT_10 = new Date('2026-07-18T08:00:00Z');   // Saturday 10:00 in Paris
const PARIS_SUN_10 = new Date('2026-07-19T08:00:00Z');   // Sunday 10:00 in Paris
const before = (base: Date, days: number) => new Date(base.getTime() - days * 86400000);
const sentMail = (base: Date, sentDaysBefore: number, extra: Record<string, unknown> = {}) => ({ id: `mail-${sentDaysBefore}`, status: 'SENT', recipientEmail: 'entreprise@example.com', subject: 'Observation', body: 'Texte', sentAt: before(base, sentDaysBefore), lastRemindedAt: null, reminderCount: 0, ...extra });
const draftMail = (extra: Record<string, unknown> = {}) => ({ id: 'draft', status: 'DRAFT', recipientEmail: 'entreprise@example.com', subject: 'Brouillon jamais envoyé', body: 'Texte IA non relu', sentAt: null, lastRemindedAt: null, reminderCount: 0, ...extra });
const obsAt = (base: Date, extra: Record<string, unknown> = {}) => observation({ updatedAt: base, generatedEmails: [sentMail(base, 4)], ...extra });
const AUTO_ON = { REMINDER_AUTOMATION_ENABLED: 'true' };
const defaults = reminderSettings(() => undefined);

test('settings: defaults, configured values and invalid input', () => {
  assert.deepEqual(defaults, { maxAutomaticReminders: 3, timezone: 'Europe/Paris', startHour: 8, endHour: 18 });
  const env: Record<string, string> = { MAX_AUTOMATIC_REMINDERS: '5', REMINDER_TIMEZONE: 'America/Montreal', REMINDER_START_HOUR: '9', REMINDER_END_HOUR: '17' };
  assert.deepEqual(reminderSettings(k => env[k]), { maxAutomaticReminders: 5, timezone: 'America/Montreal', startHour: 9, endHour: 17 });
  const bad: Record<string, string> = { MAX_AUTOMATIC_REMINDERS: 'many', REMINDER_TIMEZONE: 'Mars/Olympus', REMINDER_START_HOUR: '20', REMINDER_END_HOUR: '6' };
  assert.deepEqual(reminderSettings(k => bad[k]), defaults, 'invalid values and an end before the start fall back to the defaults');
  assert.equal(reminderSettings(k => ({ MAX_AUTOMATIC_REMINDERS: '0' } as Record<string, string>)[k]).maxAutomaticReminders, 0);
});

test('sending window: weekdays 08:00-18:00 Paris time only', () => {
  assert.equal(sendingWindow(PARIS_WED_10, defaults).allowed, true);
  assert.equal(sendingWindow(new Date('2026-07-15T06:00:00Z'), defaults).allowed, true, '08:00 sharp is allowed');
  assert.deepEqual([sendingWindow(new Date('2026-07-15T16:00:00Z'), defaults).allowed, sendingWindow(new Date('2026-07-15T15:59:00Z'), defaults).allowed], [false, true], '18:00 is the end, 17:59 is still allowed');
  assert.equal(sendingWindow(PARIS_WED_03, defaults).reason, 'outside-hours');
  assert.equal(sendingWindow(PARIS_WED_19, defaults).reason, 'outside-hours');
  assert.equal(sendingWindow(PARIS_SAT_10, defaults).reason, 'weekend');
  assert.equal(sendingWindow(PARIS_SUN_10, defaults).reason, 'weekend');
  // Winter (UTC+1): 08:00 Paris is 07:00 UTC, so 06:30 UTC is still night.
  assert.equal(sendingWindow(new Date('2026-01-14T06:30:00Z'), defaults).allowed, false);
  assert.equal(sendingWindow(new Date('2026-01-14T07:00:00Z'), defaults).allowed, true);
});

test('per-email decision: draft, sent, cooldown, maximum', () => {
  const now = PARIS_WED_10;
  assert.equal(emailDecision(draftMail(), now, 0, 3), 'NEVER_SENT');
  assert.equal(emailDecision(draftMail({ status: 'NEEDS_RECIPIENT', recipientEmail: null }), now, 0, 3), 'NO_RECIPIENT');
  assert.equal(emailDecision({ ...sentMail(now, 9), status: 'ERROR' }, now, 0, 3), 'NEVER_SENT', 'a failed send does not count as sent');
  assert.equal(emailDecision(sentMail(now, 4), now, 0, 3), 'SEND');
  assert.equal(emailDecision(sentMail(now, 4, { status: 'DELIVERED' }), now, 2, 3), 'SEND');
  assert.equal(emailDecision(sentMail(now, 4), now, 3, 3), 'MAX_REACHED');
  assert.equal(emailDecision(sentMail(now, 4, { lastRemindedAt: new Date(now.getTime() - 23 * 3600 * 1000) }), now, 1, 3), 'COOLDOWN');
  assert.equal(emailDecision(sentMail(now, 4, { lastRemindedAt: new Date(now.getTime() - 25 * 3600 * 1000) }), now, 1, 3), 'SEND');
  assert.equal(emailDecision(sentMail(now, 4, { status: 'RESOLVED' }), now, 0, 3), 'RESOLVED');
  assert.equal(emailDecision(sentMail(now, 4), now, 0, 0), 'MAX_REACHED', 'a maximum of 0 means the scan never sends');
});

// ---------- automatic sending: scan behaviour ----------

test('an unsent draft is never sent by the scan, even on an overdue observation', async () => {
  const row = obsAt(PARIS_WED_10, { status: 'OPEN', dueDate: before(PARIS_WED_10, 10), generatedEmails: [draftMail()] });
  const { service, sentMails, store } = harness([row], AUTO_ON);
  const auto = await service.scanAll({ now: PARIS_WED_10 });
  assert.equal(auto.results[0].emailsSent, 0);
  assert.equal(auto.results[0].skipped.neverSent, 1);
  assert.equal(sentMails.length, 0);
  assert.equal(row.status, 'TO_RELAUNCH', 'the observation is still flagged for a person to act on');
  assert.equal(row.generatedEmails[0].reminderCount, 0);
  // the same holds for a manual scan
  const manual = await service.scan('org-1', 'user-1', { now: new Date(PARIS_WED_10.getTime() + 60000) });
  assert.equal(manual.emailsSent, 0);
  assert.equal(store.sentMails.length, 0);
});

test('a previously sent email is eligible; an unsent draft next to it is left alone', async () => {
  const row = obsAt(PARIS_WED_10, { status: 'WAITING', dueDate: before(PARIS_WED_10, 2), generatedEmails: [sentMail(PARIS_WED_10, 6), draftMail()] });
  const { service, sentMails } = harness([row], AUTO_ON);
  const result = (await service.scanAll({ now: PARIS_WED_10 })).results[0];
  assert.equal(result.emailsSent, 1);
  assert.deepEqual(sentMails.map(m => m.subject), ['Relance - Observation']);
  assert.deepEqual(result.candidates[0].emails.map((e: any) => e.decision).sort(), ['NEVER_SENT', 'SEND']);
});

test('maximum reached: after MAX_AUTOMATIC_REMINDERS scan reminders the email is skipped', async () => {
  const row = obsAt(PARIS_WED_10, { status: 'TO_RELAUNCH', dueDate: before(PARIS_WED_10, 3) });
  const { service, sentMails, activity } = harness([row], { ...AUTO_ON, MAX_AUTOMATIC_REMINDERS: '2' });
  // three working days in a row, more than 24 hours apart
  const days = [PARIS_WED_10, new Date('2026-07-16T08:30:00Z'), new Date('2026-07-17T09:00:00Z')];
  const sentPerDay = [];
  for (const day of days) sentPerDay.push((await service.scanAll({ now: day })).results[0].emailsSent);
  assert.deepEqual(sentPerDay, [1, 1, 0]);
  assert.equal(sentMails.length, 2);
  assert.equal(activity.filter(a => /Relance (automatique|escaladée) envoyée/.test(a.action)).length, 2);
  const last = (await service.scanAll({ now: new Date('2026-07-20T08:00:00Z') })).results[0];
  assert.equal(last.skipped.maxReached, 1);
  assert.equal(last.candidates[0].emails[0].scanRemindersSoFar, 2);
});

test('manual "Relancer" clicks do not use up the automatic maximum', async () => {
  const row = obsAt(PARIS_WED_10, { dueDate: before(PARIS_WED_10, 3), generatedEmails: [sentMail(PARIS_WED_10, 9, { reminderCount: 7, lastRemindedAt: before(PARIS_WED_10, 2) })] });
  const { service, sentMails } = harness([row], AUTO_ON);
  assert.equal((await service.scanAll({ now: PARIS_WED_10 })).results[0].emailsSent, 1);
  assert.equal(sentMails.length, 1);
});

test('cooldown active: an email reminded less than 24 hours ago is skipped', async () => {
  const row = obsAt(PARIS_WED_10, { status: 'TO_RELAUNCH', dueDate: before(PARIS_WED_10, 3), generatedEmails: [sentMail(PARIS_WED_10, 9, { lastRemindedAt: new Date(PARIS_WED_10.getTime() - 5 * 3600 * 1000) })] });
  const { service, sentMails } = harness([row], AUTO_ON);
  const result = (await service.scanAll({ now: PARIS_WED_10 })).results[0];
  assert.equal(result.emailsSent, 0);
  assert.equal(result.skipped.cooldown, 1);
  assert.equal(sentMails.length, 0);
});

test('weekend: the automatic run is skipped entirely', async () => {
  for (const day of [PARIS_SAT_10, PARIS_SUN_10]) {
    const row = obsAt(day, { dueDate: before(day, 5) });
    const { service, sentMails, history, activity } = harness([row], AUTO_ON);
    const result = await service.scanAll({ now: day });
    assert.equal(result.ran, false);
    assert.equal(result.reason, 'weekend');
    assert.equal(sentMails.length + history.length + activity.length, 0);
    assert.equal(row.status, 'SENT');
  }
});

test('outside working hours: the automatic run is skipped entirely', async () => {
  for (const hour of [PARIS_WED_03, PARIS_WED_19]) {
    const row = obsAt(hour, { dueDate: before(hour, 5) });
    const { service, sentMails, history, activity } = harness([row], AUTO_ON);
    const result = await service.scanAll({ now: hour });
    assert.deepEqual([result.ran, result.reason], [false, 'outside-hours']);
    assert.equal(sentMails.length + history.length + activity.length, 0);
  }
});

test('REMINDER_AUTOMATION_ENABLED=false: neither the scheduler nor the cron endpoint sends anything', async () => {
  const row = obsAt(PARIS_WED_10, { dueDate: before(PARIS_WED_10, 5) });
  const { service, sentMails } = harness([row], {});
  const result = await service.scanAll({ now: PARIS_WED_10 });
  assert.deepEqual([result.ran, result.reason], [false, 'disabled']);
  assert.equal(sentMails.length, 0);
  assert.equal(row.status, 'SENT');
});

test('a manual scan outside hours and on a weekend still works', async () => {
  for (const moment of [PARIS_WED_03, PARIS_SUN_10]) {
    const row = obsAt(moment, { dueDate: before(moment, 5) });
    const { service, sentMails } = harness([row], {});
    const result = await service.scan('org-1', 'admin', { now: moment });
    assert.equal(result.ran, true);
    assert.equal(result.window.allowed, false);
    assert.equal(result.emailsSent, 1);
    assert.equal(sentMails.length, 1);
    assert.equal(row.status, 'TO_RELAUNCH');
  }
});

test('two backend instances at the same moment: one run only', async () => {
  const row = obsAt(PARIS_WED_10, { dueDate: before(PARIS_WED_10, 5) });
  const a = harness([row], AUTO_ON);
  const b = harness([row], AUTO_ON, true, a.store);
  a.store.sendDelayMs = 20;
  const [ra, rb] = await Promise.all([a.service.scanAll({ now: PARIS_WED_10 }), b.service.scanAll({ now: PARIS_WED_10 })]);
  const outcomes = [ra.results[0], rb.results[0]];
  assert.equal(outcomes.filter(r => r.ran).length, 1);
  assert.equal(outcomes.find(r => !r.ran).reason, 'in-progress');
  assert.equal(a.store.sentMails.length, 1);
  assert.equal(a.store.history.length, 1, 'the status change is recorded once');
  assert.equal(row.generatedEmails[0].reminderCount, 1);
});

test('internal scheduler and external cron in the same hour: one run only', async () => {
  const row = obsAt(PARIS_WED_10, { dueDate: before(PARIS_WED_10, 5) });
  const { service, sentMails } = harness([row], AUTO_ON);
  const internal = await service.scanAll({ now: PARIS_WED_10 });
  const external = await service.scanAll({ now: new Date(PARIS_WED_10.getTime() + 90 * 1000) });
  assert.equal(internal.results[0].ran, true);
  assert.deepEqual([external.results[0].ran, external.results[0].reason], [false, 'recent-run']);
  assert.equal(sentMails.length, 1);
  // the next hourly run is accepted again (and then stopped by the cooldown, not by the run lock)
  const nextHour = await service.scanAll({ now: new Date(PARIS_WED_10.getTime() + 3600 * 1000) });
  assert.equal(nextHour.results[0].ran, true);
  assert.equal(nextHour.results[0].emailsSent, 0);
  assert.equal(sentMails.length, 1);
});

test('a manual scan while another run is in progress is refused with a clear message', async () => {
  const row = obsAt(PARIS_WED_10, { dueDate: before(PARIS_WED_10, 5) });
  const a = harness([row], AUTO_ON);
  a.store.sendDelayMs = 30;
  const running = a.service.scanAll({ now: PARIS_WED_10 });
  await new Promise(r => setTimeout(r, 5));
  await assert.rejects(() => a.service.scan('org-1', 'admin', { now: PARIS_WED_10 }), /déjà en cours/);
  await running;
  assert.equal(a.store.sentMails.length, 1);
});

test('a run that crashed does not block later runs for ever', async () => {
  const row = obsAt(PARIS_WED_10, { dueDate: before(PARIS_WED_10, 5) });
  const { service, sentMails, activity } = harness([row], AUTO_ON);
  activity.push({ id: 'stale', entityType: 'ReminderRun', entityId: 'org-1:auto', action: 'Scan des relances en cours', createdAt: new Date(PARIS_WED_10.getTime() - 20 * 60 * 1000) });
  assert.equal((await service.scanAll({ now: PARIS_WED_10 })).results[0].ran, true);
  assert.equal(sentMails.length, 1);
});

test('dry run: reports exactly what would happen, sends and changes nothing', async () => {
  const overdue = obsAt(PARIS_WED_10, { id: 'obs-a', status: 'WAITING', dueDate: before(PARIS_WED_10, 15), generatedEmails: [sentMail(PARIS_WED_10, 20, { id: 'mail-a' }), draftMail({ id: 'draft-a' })] });
  const stale = obsAt(PARIS_WED_10, { id: 'obs-b', title: 'Sans réponse', generatedEmails: [sentMail(PARIS_WED_10, 5, { id: 'mail-b' })] });
  const snapshot = JSON.stringify([overdue, stale]);
  const { service, sentMails, history, activity } = harness([overdue, stale], {});
  const auto = await service.scanAll({ dryRun: true, now: PARIS_WED_10 });
  assert.equal(auto.ran, true, 'a preview is available even while automation is disabled');
  const preview = auto.results[0];
  assert.equal(preview.dryRun, true);
  assert.deepEqual([preview.checked, preview.markedForReminder, preview.escalated, preview.emailsSent], [2, 2, 1, 2]);
  assert.equal(preview.skipped.neverSent, 1);
  const a = preview.candidates.find((c: any) => c.observationId === 'obs-a');
  assert.deepEqual([a.reason, a.wouldMarkToRelaunch, a.escalationFrom, a.escalationTo], ['OVERDUE', true, 0, 3]);
  assert.deepEqual(a.emails.map((e: any) => [e.emailId, e.decision, e.subject]), [['mail-a', 'SEND', 'Relance urgente - Observation'], ['draft-a', 'NEVER_SENT', 'Relance urgente - Brouillon jamais envoyé']]);
  const b = preview.candidates.find((c: any) => c.observationId === 'obs-b');
  assert.deepEqual([b.reason, b.emails[0].decision, b.emails[0].recipient], ['STALE_SENT', 'SEND', 'entreprise@example.com']);
  // nothing happened
  assert.equal(sentMails.length + history.length + activity.length, 0);
  assert.equal(JSON.stringify([overdue, stale]), snapshot, 'no status, escalation level, reminder count or date changed');
  // a manual preview behaves the same, and a real run afterwards does what the preview announced
  const manualPreview = await service.scan('org-1', 'admin', { dryRun: true, now: PARIS_WED_10 });
  assert.equal(manualPreview.emailsSent, 2);
  assert.equal(sentMails.length, 0);
  const real = await service.scan('org-1', 'admin', { now: PARIS_WED_10 });
  assert.deepEqual([real.markedForReminder, real.escalated, real.emailsSent], [2, 1, 2]);
  assert.equal(sentMails.length, 2);
});

test('a failed send gives the reminder slot back and is reported', async () => {
  const row = obsAt(PARIS_WED_10, { dueDate: before(PARIS_WED_10, 5) });
  const { service, store } = harness([row], AUTO_ON);
  store.failSend = true;
  const result = (await service.scanAll({ now: PARIS_WED_10 })).results[0];
  assert.deepEqual([result.emailsSent, result.skipped.failed], [0, 1]);
  assert.equal(row.generatedEmails[0].reminderCount, 0);
  assert.equal(row.generatedEmails[0].lastRemindedAt, null);
});

test('existing escalation still works through the automatic run', async () => {
  const row = obsAt(PARIS_WED_10, { status: 'WAITING', dueDate: before(PARIS_WED_10, 8) });
  const { service, sentMails, activity } = harness([row], AUTO_ON);
  const result = (await service.scanAll({ now: PARIS_WED_10 })).results[0];
  assert.deepEqual([result.markedForReminder, result.escalated, result.emailsSent], [1, 1, 1]);
  assert.equal(row.escalationLevel, 2, '8 days overdue with 7-day steps is level 2');
  assert.match(sentMails[0].subject, /^Relance urgente - /);
  assert.ok(activity.some(a => a.action === 'Escalade niveau 2') && activity.some(a => a.action === 'Relance escaladée envoyée'));
});

test('dry run on a weekend: the preview is still produced and says the window is closed', async () => {
  const row = obsAt(PARIS_SAT_10, { dueDate: before(PARIS_SAT_10, 5) });
  const { service, sentMails, history, activity } = harness([row], AUTO_ON);
  const preview = (await service.scanAll({ dryRun: true, now: PARIS_SAT_10 })).results[0];
  assert.deepEqual([preview.ran, preview.emailsSent, preview.window.allowed, preview.window.reason], [true, 1, false, 'weekend']);
  assert.equal(sentMails.length + history.length + activity.length, 0);
  assert.equal((await service.scanAll({ now: PARIS_SAT_10 })).ran, false, 'the real automatic run is still refused');
});
