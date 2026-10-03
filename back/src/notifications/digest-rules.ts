// Pure rules for the daily digest schedule. Kept free of database and email code so they can be
// unit-tested (see back/test/digest.test.ts).

export const DEFAULT_DIGEST_TIMEZONE = 'Europe/Paris';
// 08:00, Monday to Friday, evaluated in the digest timezone (so it follows daylight saving time).
export const DIGEST_CRON = '0 8 * * 1-5';

export function isValidTimezone(zone: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}

// DAILY_DIGEST_TIMEZONE: an IANA zone name. Empty or unknown falls back to Europe/Paris.
export function digestTimezone(raw: unknown): string {
  const zone = String(raw ?? '').trim();
  return zone && isValidTimezone(zone) ? zone : DEFAULT_DIGEST_TIMEZONE;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Calendar date, weekday and hour of an instant as seen in the given timezone.
export function localDay(instant: Date, zone: string): { date: string; weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday: WEEKDAYS.indexOf(get('weekday')), hour: Number(get('hour')) };
}

// The scheduled digest is not sent on Saturdays and Sundays (local calendar).
export function isDigestDay(instant: Date, zone: string): boolean {
  const { weekday } = localDay(instant, zone);
  return weekday >= 1 && weekday <= 5;
}

// One digest per user and per local calendar day: this key identifies that slot.
export function digestSlot(userId: string, instant: Date, zone: string): string {
  return `${userId}:${localDay(instant, zone).date}`;
}
