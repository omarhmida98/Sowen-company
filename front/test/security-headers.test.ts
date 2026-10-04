// Security headers of the web application. Run with: npm --workspace front test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentSecurityPolicy, securityHeaders } from '../src/lib/security-headers';

const value = (headers: { key: string; value: string }[], key: string) => headers.find(h => h.key === key)?.value;

test('every page gets nosniff, no-referrer, frame protection and a content security policy', () => {
  const headers = securityHeaders({ apiUrl: 'https://app.example.com/api', https: true });
  assert.equal(value(headers, 'X-Content-Type-Options'), 'nosniff');
  assert.equal(value(headers, 'Referrer-Policy'), 'no-referrer');
  assert.equal(value(headers, 'X-Frame-Options'), 'DENY');
  const csp = value(headers, 'Content-Security-Policy')!;
  for (const part of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"]) assert.ok(csp.includes(part), part);
});

test('the policy lets pages reach this site and the API only, and never loads scripts from another site', () => {
  const csp = contentSecurityPolicy({ apiUrl: 'https://api.example.com/api' });
  assert.match(csp, /connect-src 'self' https:\/\/api\.example\.com(;|$)/);
  const scripts = csp.split('; ').find(p => p.startsWith('script-src'))!;
  assert.doesNotMatch(scripts, /https?:|\*|unsafe-eval/);
  // development needs the hot-reload socket and eval; production does not get them
  assert.match(contentSecurityPolicy({ development: true }), /unsafe-eval/);
  assert.match(contentSecurityPolicy({ development: true }), /connect-src [^;]*ws:/);
});

test('HSTS is sent only by a production build served over https', () => {
  assert.equal(value(securityHeaders({ https: true }), 'Strict-Transport-Security'), 'max-age=31536000');
  assert.equal(value(securityHeaders({ https: false }), 'Strict-Transport-Security'), undefined);
  assert.equal(value(securityHeaders({ https: true, development: true }), 'Strict-Transport-Security'), undefined);
});

test('the Next.js configuration applies the headers to every route and hides the framework header', () => {
  const config = readFileSync(join(__dirname, '..', 'next.config.ts'), 'utf8');
  assert.match(config, /poweredByHeader: false/);
  assert.match(config, /source: '\/:path\*', headers: securityHeaders\(/);
});
