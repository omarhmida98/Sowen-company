// The persistent rate limiter against a real PostgreSQL database (the one of back/.env, DATABASE_URL).
// Run with: npm --workspace back test. Each test uses random counter keys in the AuthRateLimit table and removes
// them; no other table is touched. Without a reachable database these tests are skipped.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { AuthRateLimit, PrismaRateLimitStore, counters, rateLimitSettings } from '../src/auth/rate-limiter';

// Two clients = two API instances connected to the same database.
let first: PrismaClient, second: PrismaClient, available = false;
const used: string[] = [];
const key = (label = 'k') => { const k = `test-${label}-${randomUUID()}`; used.push(k); return k; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

before(async () => {
  try {
    first = new PrismaClient(); second = new PrismaClient();
    await first.$queryRaw`SELECT 1 FROM "AuthRateLimit" LIMIT 1`;
    await second.$queryRaw`SELECT 1`;
    available = true;
  } catch { available = false; }
});
after(async () => {
  if (available) await first.authRateLimit.deleteMany({ where: { key: { in: used } } });
  await first?.$disconnect().catch(() => {}); await second?.$disconnect().catch(() => {});
});
const db = (name: string, fn: () => Promise<void>) => test(name, async t => { if (!available) return t.skip('no database reachable'); await fn(); });

db('counters are stored in PostgreSQL and survive a new store / backend instance', async () => {
  const k = key();
  const store = new PrismaRateLimitStore(first as any);
  assert.equal((await store.hit([k], 60000))[0].count, 1);
  assert.equal((await store.hit([k], 60000))[0].count, 2);
  // A brand new store on a brand new connection (a restarted backend) continues the same counter.
  const restarted = new PrismaRateLimitStore(second as any);
  const [row] = await restarted.hit([k], 60000);
  assert.equal(row.count, 3);
  assert.ok(row.retryMs > 55000 && row.retryMs <= 60000, `retryMs ${row.retryMs}`);
  const saved = await first.authRateLimit.findUnique({ where: { key: k } });
  assert.equal(saved!.count, 3);
});

db('two backend instances share the same limit, even when they are hit at the same time', async () => {
  const k = key();
  const a = new PrismaRateLimitStore(first as any), b = new PrismaRateLimitStore(second as any);
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).hit([k], 60000)));
  // Every attempt was counted exactly once: the counts are 1..20 with no duplicate and no gap.
  assert.deepEqual(results.map(r => r[0].count).sort((x, y) => x - y), Array.from({ length: 20 }, (_, i) => i + 1));
});

db('several counters are written in one atomic statement, without deadlock', async () => {
  const keys = [key('a'), key('b'), key('c')];
  const a = new PrismaRateLimitStore(first as any), b = new PrismaRateLimitStore(second as any);
  await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).hit(i % 3 ? keys : [...keys].reverse(), 60000)));
  const rows = await first.authRateLimit.findMany({ where: { key: { in: keys } } });
  assert.deepEqual(rows.map(r => r.count), [10, 10, 10]);
});

db('window expiry clears the block: after the window the counter starts again from one', async () => {
  const k = key();
  const store = new PrismaRateLimitStore(first as any);
  await store.hit([k], 400); await store.hit([k], 400);
  const blocked = await store.hit([k], 400);
  assert.equal(blocked[0].count, 3);
  const resetAt = (await first.authRateLimit.findUnique({ where: { key: k } }))!.resetAt.getTime();
  // More attempts inside the window do not move its end.
  assert.equal((await first.authRateLimit.findUnique({ where: { key: k } }))!.resetAt.getTime(), resetAt);
  await sleep(700);
  const [fresh] = await new PrismaRateLimitStore(second as any).hit([k], 60000);
  assert.equal(fresh.count, 1, 'the expired counter restarted');
  assert.ok(fresh.retryMs > 55000, 'with a new window');
});

db('release gives one attempt back, clear forgets the counter', async () => {
  const kept = key('ip'), cleared = key('acct');
  const store = new PrismaRateLimitStore(first as any);
  for (let i = 0; i < 3; i++) await store.hit([kept, cleared], 60000);
  await store.release([kept]);
  await new PrismaRateLimitStore(second as any).clear([cleared]);
  assert.equal((await first.authRateLimit.findUnique({ where: { key: kept } }))!.count, 2);
  assert.equal(await first.authRateLimit.findUnique({ where: { key: cleared } }), null);
  for (let i = 0; i < 5; i++) await store.release([kept]);
  assert.equal((await first.authRateLimit.findUnique({ where: { key: kept } }))!.count, 0, 'never below zero');
  await store.release([]); await store.clear([]);
});

db('cleanup deletes expired records and keeps live ones', async () => {
  const expired = [key('old'), key('old')], live = key('live');
  const store = new PrismaRateLimitStore(first as any);
  await store.hit(expired, 200);
  await store.hit([live], 60000);
  await sleep(450);
  const removed = await new PrismaRateLimitStore(second as any).sweep();
  assert.ok(removed >= 2, `removed ${removed}`);
  assert.equal(await first.authRateLimit.count({ where: { key: { in: expired } } }), 0);
  assert.equal(await first.authRateLimit.count({ where: { key: live } }), 1);
  assert.equal(await first.authRateLimit.count({ where: { resetAt: { lte: new Date(Date.now() - 2000) } } }), 0, 'nothing expired is left in the table');
});

db('the service on the real table: limit, restart, second instance, success reset, generic answer', async () => {
  const secret = `secret-${randomUUID()}`, ip = `198.51.100.${Math.floor(Math.random() * 250)}`, account = `someone-${randomUUID()}@example.com`;
  const env: Record<string, string> = { JWT_ACCESS_SECRET: secret, AUTH_LOGIN_MAX_ATTEMPTS: '3', AUTH_RATE_LIMIT_WINDOW_MINUTES: '15' };
  const config = { get: (k: string) => env[k], getOrThrow: (k: string) => env[k] };
  for (const c of counters('login', { ip, account }, rateLimitSettings(env), secret)) used.push(c.key);
  const instance = (client: PrismaClient) => new AuthRateLimit(config as any, client as any);
  const attempt = (limit: AuthRateLimit, who = account) => limit.begin('login', { ip, account: who }).then(r => r, (e: any) => `${e.status} ${e.message}`);

  const one = instance(first);
  for (let i = 0; i < 3; i++) assert.equal(typeof (await attempt(one)), 'object', `attempt ${i + 1} is allowed`);
  // A restarted backend and a second instance both see the three attempts already made.
  assert.equal(await attempt(instance(first)), '429 Trop de tentatives. Réessayez dans 15 minutes.');
  assert.equal(await attempt(instance(second)), '429 Trop de tentatives. Réessayez dans 15 minutes.');

  // What is stored: three hashed rows, nothing readable.
  const keys = counters('login', { ip, account }, rateLimitSettings(env), secret).map(c => c.key);
  const rows = await first.authRateLimit.findMany({ where: { key: { in: keys } } });
  assert.equal(rows.length, 3);
  assert.equal(JSON.stringify(rows).includes(account) || JSON.stringify(rows).includes(ip), false);

  // A success for another account from the same address, begun on one instance and completed on the other:
  // its account counters are removed and the attempt is given back to the address counter.
  const other = `other-${randomUUID()}@example.com`;
  for (const c of counters('login', { ip, account: other }, rateLimitSettings(env), secret)) used.push(c.key);
  const ipKey = keys[2];
  const before = (await first.authRateLimit.findUnique({ where: { key: ipKey } }))!.count;
  const reservation = await instance(second).begin('login', { ip, account: other });
  await instance(first).succeeded(reservation);
  assert.equal(await first.authRateLimit.count({ where: { key: { in: reservation.accountKeys } } }), 0);
  assert.equal((await first.authRateLimit.findUnique({ where: { key: ipKey } }))!.count, before, 'the successful attempt does not use the address budget');
  assert.equal(await first.authRateLimit.count({ where: { key: { in: keys.slice(0, 2) } } }), 2, 'the blocked account is still blocked');
});
