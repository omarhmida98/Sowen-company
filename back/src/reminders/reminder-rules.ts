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

// ---- Automatic sending rules ----

export const DEFAULT_MAX_AUTOMATIC_REMINDERS = 3;
export const DEFAULT_REMINDER_TIMEZONE = 'Europe/Paris';
export const DEFAULT_REMINDER_START_HOUR = 8;
export const DEFAULT_REMINDER_END_HOUR = 18;
export const REMINDER_COOLDOWN_MS = 24 * 3600 * 1000;

export type ReminderSettings = { maxAutomaticReminders: number; timezone: string; startHour: number; endHour: number };

function wholeNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const text = String(raw ?? '').trim();
  if (!text) return fallback;
  const value = Number(text);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function validTimezone(zone: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}

// MAX_AUTOMATIC_REMINDERS, REMINDER_TIMEZONE, REMINDER_START_HOUR, REMINDER_END_HOUR.
// Empty or invalid values fall back to 3 reminders, Europe/Paris, 08:00 to 18:00.
export function reminderSettings(get: (key: string) => unknown): ReminderSettings {
  const zone = String(get('REMINDER_TIMEZONE') ?? '').trim();
  let startHour = wholeNumber(get('REMINDER_START_HOUR'), DEFAULT_REMINDER_START_HOUR, 0, 23);
  let endHour = wholeNumber(get('REMINDER_END_HOUR'), DEFAULT_REMINDER_END_HOUR, 1, 24);
  if (endHour <= startHour) { startHour = DEFAULT_REMINDER_START_HOUR; endHour = DEFAULT_REMINDER_END_HOUR; }
  return {
    maxAutomaticReminders: wholeNumber(get('MAX_AUTOMATIC_REMINDERS'), DEFAULT_MAX_AUTOMATIC_REMINDERS, 0, 100),
    timezone: zone && validTimezone(zone) ? zone : DEFAULT_REMINDER_TIMEZONE,
    startHour,
    endHour,
  };
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Whether an automatic run may send now: Monday to Friday, from startHour (included) to endHour (excluded), local time.
export function sendingWindow(now: Date, settings: ReminderSettings): { allowed: boolean; reason: 'weekend' | 'outside-hours' | null; localTime: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: settings.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  const weekday = WEEKDAY_INDEX[get('weekday')];
  const hour = Number(get('hour'));
  const localTime = `${get('weekday')} ${get('hour')}:${get('minute')} (${settings.timezone})`;
  if (weekday === 0 || weekday === 6) return { allowed: false, reason: 'weekend', localTime };
  if (hour < settings.startHour || hour >= settings.endHour) return { allowed: false, reason: 'outside-hours', localTime };
  return { allowed: true, reason: null, localTime };
}

export type EmailDecision = 'SEND' | 'NEVER_SENT' | 'NO_RECIPIENT' | 'RESOLVED' | 'COOLDOWN' | 'MAX_REACHED';

// Decides whether the scan may remind on this email record. `automaticCount` is how many reminders the scan already sent for it.
export function emailDecision(email: ReminderEmail, now: Date, automaticCount: number, maxAutomaticReminders: number): EmailDecision {
  if (email.status === 'RESOLVED') return 'RESOLVED';
  if (!email.recipientEmail) return 'NO_RECIPIENT';
  // A draft that was never sent is never sent by the scan: a person must send the first email.
  if (!wasSent(email)) return 'NEVER_SENT';
  if (automaticCount >= maxAutomaticReminders) return 'MAX_REACHED';
  if (email.lastRemindedAt && now.getTime() - email.lastRemindedAt.getTime() <= REMINDER_COOLDOWN_MS) return 'COOLDOWN';
  return 'SEND';
}
