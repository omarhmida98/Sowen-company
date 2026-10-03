import { createHash, randomBytes } from 'crypto';

// Invitation and password-reset links. The link carries a random token; only its SHA-256 is stored, so reading the
// database does not give a usable link.

export type AccountLinkType = 'INVITATION' | 'PASSWORD_RESET';

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(String(token)).digest('hex');

const hours = (raw: unknown, fallback: number) => { const n = Number(String(raw ?? '').trim()); return String(raw ?? '').trim() !== '' && Number.isFinite(n) && n > 0 ? n : fallback; };

// INVITATION_TTL_HOURS (default 72) and PASSWORD_RESET_TTL_HOURS (default 24).
export function linkTtlHours(type: AccountLinkType, env: Record<string, unknown>): number {
  return type === 'INVITATION' ? hours(env.INVITATION_TTL_HOURS, 72) : hours(env.PASSWORD_RESET_TTL_HOURS, 24);
}

export const isUsable = (token: { usedAt: Date | null; expiresAt: Date }, now = new Date()) => !token.usedAt && token.expiresAt.getTime() > now.getTime();

// Where the link points. PUBLIC_APP_URL is used when set. Without it, outside production, the local web address is
// used and the link is only shown to the administrator (it would be useless in an email). In production a public
// address is required.
export function linkBase(env: { publicAppUrl: string | null; webUrl?: string | null; nodeEnv?: string | null }): { base: string; public: boolean } | null {
  if (env.publicAppUrl) return { base: env.publicAppUrl, public: true };
  if ((env.nodeEnv || '').trim().toLowerCase() === 'production') return null;
  const first = String(env.webUrl || 'http://localhost:3000').split(',')[0].trim().replace(/\/+$/, '');
  return { base: first || 'http://localhost:3000', public: false };
}

export const accountLink = (base: string, token: string) => `${base}/invitation/${token}`;
