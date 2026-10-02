// Reminder scan tests. Run with: npm --workspace back test
// No database or email provider is needed: Prisma and the mailer are replaced by in-memory fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SENT_REMINDER_DAYS, lastCompanyContact, reminderReason, sentReminderDays } from '../src/reminders/reminder-rules';
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

function harness(rows: any[], env: Record<string, string> = {}, mailerConfigured = true) {
  const sentMails: any[] = [], history: any[] = [], activity: any[] = [];
  const prisma: any = {
    organization: { findUnique: async () => ({ reminderDays: 7, escalationDays: 7 }) },
    // Returns every row: the service must rely on reminderReason(), not on the query, to decide.
    // Copies are returned, as a real database would: updates only reach `rows` through update().
    observation: {
      findMany: async () => structuredClone(rows),
      update: async ({ where, data }: any) => Object.assign(rows.find(r => r.id === where.id), data),
    },
    observationHistory: { create: async ({ data }: any) => { history.push(data); } },
    activityLog: { create: async ({ data }: any) => { activity.push(data); } },
    generatedEmail: { update: async ({ where, data }: any) => { const mail = rows.flatMap(r => r.generatedEmails).find((m: any) => m.id === where.id); mail.lastRemindedAt = data.lastRemindedAt; mail.reminderCount += 1; } },
  };
  const config: any = { get: (key: string) => env[key] };
  const mailer: any = { isConfigured: () => mailerConfigured, publicAppUrl: () => null, send: async (mail: any) => { sentMails.push(mail); return { id: 'fake' }; } };
  return { service: new RemindersService(prisma, config, mailer), sentMails, history, activity };
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
