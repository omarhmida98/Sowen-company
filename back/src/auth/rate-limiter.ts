import { HttpException, HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

// Attempt counters for the sensitive authentication endpoints. They live in PostgreSQL (table AuthRateLimit), so
// they survive a restart of the API and are shared by every API instance using the same database.
//
// One row per counter: a keyed hash of what is counted, the number of attempts and when the window ends. The window
// starts at the first attempt and is never extended, so nobody stays locked: when it ends the counter starts again.
// Rows hold no email, address, password or token, only the hash.

export type Counter = { key: string; count: number; retryMs: number };

export interface RateLimitStore {
  // Counts one attempt on each key, atomically, and returns the counters after the attempt.
  hit(keys: string[], windowMs: number): Promise<Counter[]>;
  // Gives one attempt back (the attempt turned out to be legitimate).
  release(keys: string[]): Promise<void>;
  clear(keys: string[]): Promise<void>;
  // Deletes the counters whose window has ended. Returns how many were deleted.
  sweep(): Promise<number>;
}

// The database clock is used for every comparison, so instances whose clocks differ still agree.
export class PrismaRateLimitStore implements RateLimitStore {
  constructor(private prisma: PrismaService) {}

  async hit(keys: string[], windowMs: number): Promise<Counter[]> {
    // Keys are written in a fixed order so that two concurrent requests cannot deadlock.
    const sorted = [...new Set(keys)].sort();
    const rows = await this.prisma.$queryRaw<{ key: string; count: number; retryMs: number }[]>(Prisma.sql`
      INSERT INTO "AuthRateLimit" ("key", "count", "resetAt", "updatedAt")
      SELECT k, 1, now() + (${windowMs}::float8 * interval '1 millisecond'), now() FROM unnest(${sorted}::text[]) AS k ORDER BY k
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "AuthRateLimit"."resetAt" <= now() THEN 1 ELSE "AuthRateLimit"."count" + 1 END,
        "resetAt" = CASE WHEN "AuthRateLimit"."resetAt" <= now() THEN EXCLUDED."resetAt" ELSE "AuthRateLimit"."resetAt" END,
        "updatedAt" = now()
      RETURNING "key", "count", (EXTRACT(EPOCH FROM ("resetAt" - now())) * 1000)::float8 AS "retryMs"`);
    return rows.map(r => ({ key: r.key, count: Number(r.count), retryMs: Math.max(0, Number(r.retryMs)) }));
  }

  async release(keys: string[]) {
    if (keys.length) await this.prisma.$executeRaw(Prisma.sql`UPDATE "AuthRateLimit" SET "count" = GREATEST("count" - 1, 0), "updatedAt" = now() WHERE "key" = ANY(${keys}::text[]) AND "resetAt" > now()`);
  }

  async clear(keys: string[]) {
    if (keys.length) await this.prisma.$executeRaw(Prisma.sql`DELETE FROM "AuthRateLimit" WHERE "key" = ANY(${keys}::text[])`);
  }

  async sweep() {
    return Number(await this.prisma.$executeRaw(Prisma.sql`DELETE FROM "AuthRateLimit" WHERE "resetAt" <= now()`));
  }
}

export type RateLimitSettings = { enabled: boolean; windowMs: number; perAccountAndIp: number; perAccount: number; perIp: number };

const positive = (raw: unknown, fallback: number) => { const n = Number(String(raw ?? '').trim()); return String(raw ?? '').trim() !== '' && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback; };
// The window may be a fraction of a minute.
const minutes = (raw: unknown, fallback: number) => { const n = Number(String(raw ?? '').trim()); return String(raw ?? '').trim() !== '' && Number.isFinite(n) && n > 0 ? n : fallback; };

// AUTH_RATE_LIMIT_ENABLED (default true), AUTH_RATE_LIMIT_WINDOW_MINUTES (15), AUTH_LOGIN_MAX_ATTEMPTS (5, same account
// from the same address), AUTH_ACCOUNT_MAX_ATTEMPTS (20, same account from any address), AUTH_IP_MAX_ATTEMPTS (50, same address).
export function rateLimitSettings(env: Record<string, unknown>): RateLimitSettings {
  return {
    enabled: String(env.AUTH_RATE_LIMIT_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
    windowMs: Math.round(minutes(env.AUTH_RATE_LIMIT_WINDOW_MINUTES, 15) * 60000),
    perAccountAndIp: positive(env.AUTH_LOGIN_MAX_ATTEMPTS, 5),
    perAccount: positive(env.AUTH_ACCOUNT_MAX_ATTEMPTS, 20),
    perIp: positive(env.AUTH_IP_MAX_ATTEMPTS, 50),
  };
}

export type Attempt = { ip?: string | null; account?: string | null };
// What begin() hands back, to be passed to succeeded().
export type Reservation = { accountKeys: string[]; ipKeys: string[] };

// The stored key is an HMAC of the counter name: the table cannot be read back into emails or addresses, and
// every instance sharing the same secret computes the same key.
export function counterKey(secret: string, name: string) {
  return createHmac('sha256', `sowen-rate-limit:${secret}`).update(name).digest('hex');
}

// The three counters of an attempt, with their limits. `account` is an email (sign-in) or a user id (password change).
export function counters(scope: string, a: Attempt, s: RateLimitSettings, secret: string): { key: string; max: number; kind: 'account' | 'ip' }[] {
  const ip = (a.ip || 'unknown').trim(), account = (a.account || '').trim().toLowerCase();
  return [
    ...(account ? [
      { key: counterKey(secret, `${scope}|acct+ip|${account}|${ip}`), max: s.perAccountAndIp, kind: 'account' as const },
      { key: counterKey(secret, `${scope}|acct|${account}`), max: s.perAccount, kind: 'account' as const },
    ] : []),
    // one counter per address for every sensitive endpoint together
    { key: counterKey(secret, `ip|${ip}`), max: s.perIp, kind: 'ip' as const },
  ];
}

// The message is the same whether the account exists or not.
export function tooManyAttempts(ms: number) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  return new HttpException(`Trop de tentatives. Réessayez dans ${mins} minute${mins > 1 ? 's' : ''}.`, HttpStatus.TOO_MANY_REQUESTS);
}

const SWEEP_EVERY_MS = 10 * 60000;

@Injectable()
export class AuthRateLimit implements OnModuleInit {
  private readonly logger = new Logger(AuthRateLimit.name);
  store: RateLimitStore;
  private lastSweep = 0;

  constructor(private config: ConfigService, prisma: PrismaService) {
    this.store = new PrismaRateLimitStore(prisma);
  }

  onModuleInit() { this.cleanup(); }

  private settings() {
    return rateLimitSettings({
      AUTH_RATE_LIMIT_ENABLED: this.config.get('AUTH_RATE_LIMIT_ENABLED'), AUTH_RATE_LIMIT_WINDOW_MINUTES: this.config.get('AUTH_RATE_LIMIT_WINDOW_MINUTES'),
      AUTH_LOGIN_MAX_ATTEMPTS: this.config.get('AUTH_LOGIN_MAX_ATTEMPTS'), AUTH_ACCOUNT_MAX_ATTEMPTS: this.config.get('AUTH_ACCOUNT_MAX_ATTEMPTS'), AUTH_IP_MAX_ATTEMPTS: this.config.get('AUTH_IP_MAX_ATTEMPTS'),
    });
  }

  // Call before the sensitive work. The attempt is counted first, in one atomic statement, and refused with 429 when
  // a counter is over its limit: parallel requests therefore cannot slip past the limit. A failed attempt needs
  // nothing more; a successful one calls succeeded().
  async begin(scope: string, attempt: Attempt): Promise<Reservation> {
    const s = this.settings();
    const none = { accountKeys: [], ipKeys: [] };
    if (!s.enabled) return none;
    const list = counters(scope, attempt, s, this.config.getOrThrow<string>('JWT_ACCESS_SECRET'));
    const after = await this.store.hit(list.map(c => c.key), s.windowMs);
    this.cleanupIfDue();
    const wait = Math.max(0, ...list.map(c => { const row = after.find(r => r.key === c.key); return row && row.count > c.max ? Math.max(row.retryMs, 1) : 0; }));
    if (wait > 0) throw tooManyAttempts(wait);
    return { accountKeys: list.filter(c => c.kind === 'account').map(c => c.key), ipKeys: list.filter(c => c.kind === 'ip').map(c => c.key) };
  }

  // A success forgets the failures of that account and gives the attempt back to the per-address counter.
  async succeeded(reservation: Reservation) {
    await this.store.clear(reservation.accountKeys);
    await this.store.release(reservation.ipKeys);
  }

  // Expired counters are removed at start-up and then at most every ten minutes, by whichever instance is serving.
  // An expired counter is already ignored (and restarted) by hit(), so cleanup only keeps the table small.
  async cleanup(): Promise<number> {
    this.lastSweep = Date.now();
    try { return await this.store.sweep(); } catch (e: any) { this.logger.warn(`Rate-limit cleanup failed: ${e?.message || e}`); return 0; }
  }
  private cleanupIfDue() { if (Date.now() - this.lastSweep > SWEEP_EVERY_MS) void this.cleanup(); }
}
