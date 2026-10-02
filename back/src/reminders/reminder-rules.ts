// Pure rules deciding which observations the reminder scan acts on. Kept free of database and
// email code so they can be unit-tested (see back/test/reminders.test.ts).

export const DEFAULT_SENT_REMINDER_DAYS = 3;
const DAY_MS = 86400000;

export type ReminderReason = 'OVERDUE' | 'STALE_WAITING' | 'STALE_SENT';

export type ReminderEmail = { status: string; recipientEmail?: string | null; sentAt?: Date | null; lastRemindedAt?: Date | null };
export type ReminderObservation = { status: string; dueDate?: Date | null; updatedAt: Date; generatedEmails: ReminderEmail[] };

// SENT_REMINDER_AFTER_DAYS: days without a company response before a sent observation is followed up.
// Empty or invalid falls back to the default; 0 turns this rule off.
export function sentReminderDays(raw: unknown): number {
  const text = String(raw ?? '').trim();
  if (!text) return DEFAULT_SENT_REMINDER_DAYS;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_SENT_REMINDER_DAYS;
  return Math.floor(value);
}

// An email counts as sent once it has a sent date and is not in error.
export function wasSent(email: ReminderEmail) {
  return Boolean(email.sentAt) && email.status !== 'ERROR';
}

// Last time the company was written to about this observation: the latest send or reminder.
export function lastCompanyContact(emails: ReminderEmail[]): Date | null {
  let latest: Date | null = null;
  for (const email of emails.filter(wasSent)) {
    for (const date of [email.sentAt, email.lastRemindedAt]) {
      if (date && (!latest || date > latest)) latest = date;
    }
  }
  return latest;
}

export function reminderReason(o: ReminderObservation, now: Date, settings: { reminderDays: number; sentReminderDays: number }): ReminderReason | null {
  if (o.status === 'RESOLVED') return null;
  if (o.dueDate && o.dueDate < now) return 'OVERDUE';
  if (o.status === 'WAITING' && o.updatedAt.getTime() < now.getTime() - settings.reminderDays * DAY_MS) return 'STALE_WAITING';
  if (o.status === 'SENT' && settings.sentReminderDays > 0) {
    // Still "Envoyé" means the company has not engaged: a response moves the observation out of this status.
    const contact = lastCompanyContact(o.generatedEmails);
    if (contact && contact.getTime() < now.getTime() - settings.sentReminderDays * DAY_MS) return 'STALE_SENT';
  }
  return null;
}
