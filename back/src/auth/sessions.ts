// Server-side sessions. Pure helpers, unit-tested (back/test/security.test.ts).

// "15m", "30d", "12h", "45s" or a number of seconds, as accepted by the JWT library.
export function ttlMs(raw: unknown, fallbackMs: number): number {
  const text = String(raw ?? '').trim();
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)?$/i.exec(text);
  if (!m) return fallbackMs;
  const unit = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[(m[2] || 's').toLowerCase()]!;
  const value = Number(m[1]) * unit;
  return Number.isFinite(value) && value > 0 ? value : fallbackMs;
}

// For this long after a renewal the refresh token it replaced is still accepted: two browser tabs, or two requests
// sent at the same moment, both hold the old one. After that an old refresh token means it was copied.
export const REFRESH_REUSE_GRACE_MS = 20000;

export type SessionRow = { refreshId: string; previousRefreshId: string | null; rotatedAt: Date | null; revokedAt: Date | null; expiresAt: Date };
export type RefreshDecision = 'ROTATE' | 'REPEAT' | 'REUSED' | 'DEAD';

// What to do with a refresh token whose signature is valid.
//  ROTATE  it is the current one: issue a new one
//  REPEAT  it was replaced a moment ago: hand out the current one again, without a new rotation
//  REUSED  it was replaced earlier: somebody else holds a copy, the session must end
//  DEAD    the session is revoked or expired
export function refreshDecision(session: SessionRow, rid: string | undefined, now = new Date()): RefreshDecision {
  if (session.revokedAt || session.expiresAt.getTime() <= now.getTime()) return 'DEAD';
  if (rid && rid === session.refreshId) return 'ROTATE';
  if (rid && rid === session.previousRefreshId && session.rotatedAt && now.getTime() - session.rotatedAt.getTime() <= REFRESH_REUSE_GRACE_MS) return 'REPEAT';
  return 'REUSED';
}
