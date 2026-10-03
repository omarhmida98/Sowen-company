import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', 'dist', '.git'].includes(ent.name)) continue;
    const p = path.join(dir, ent.name);
    ent.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

const required = [
  'package.json', 'docker-compose.yml', 'back/.env.example', 'front/.env.example',
  'back/prisma/schema.prisma', 'front/src/app/login/page.tsx', 'front/src/app/register/page.tsx',
];
const problems = [];
for (const rel of required) {
  if (!fs.existsSync(path.join(root, rel))) problems.push(`Missing required file: ${rel}`);
}

const EXAMPLE_TEMPLATES = ['.env.example', '.env.sample', '.env.template'];
function isSecretEnvName(name) {
  if (!name.startsWith('.env')) return false;
  return !EXAMPLE_TEMPLATES.includes(name);
}

const gitAvailable = (() => {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch { return false; }
})();

function gitIsIgnored(rel) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', rel], { cwd: root, stdio: 'ignore' });
    return true;
  } catch { return false; }
}
function gitIsTracked(rel) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: root, stdio: 'ignore' });
    return true;
  } catch { return false; }
}
function gitIgnorePatterns() {
  const patterns = [];
  for (const file of ['.gitignore', 'front/.gitignore', 'back/.gitignore']) {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    for (const line of fs.readFileSync(abs, 'utf8').split(/\r?\n/)) {
      const entry = line.trim();
      if (entry && !entry.startsWith('#')) patterns.push(entry);
    }
  }
  return patterns;
}

const ignorePatterns = gitIgnorePatterns();
function looksIgnoredByPattern(rel) {
  const base = path.basename(rel);
  return ignorePatterns.some((p) => {
    const clean = p.replace(/\/$/, '');
    if (clean.startsWith('/')) return rel === clean.slice(1);
    if (clean.includes('/')) return rel.endsWith(clean);
    return clean === base || base.startsWith(clean.replace('*', ''));
  });
}

const secretFiles = walk(root).filter((p) => isSecretEnvName(path.basename(p)));
for (const abs of secretFiles) {
  const rel = path.relative(root, abs).split(path.sep).join('/');
  const ignored = gitAvailable ? gitIsIgnored(rel) : looksIgnoredByPattern(rel);
  const tracked = gitAvailable ? gitIsTracked(rel) : false;
  if (tracked) problems.push(`Secret file is tracked by git and would ship in the release: ${rel}`);
  else if (!ignored) problems.push(`Secret file is not gitignored and would ship in the release: ${rel}`);
}

const dockerignore = path.join(root, '.dockerignore');
if (fs.existsSync(dockerignore)) {
  const text = fs.readFileSync(dockerignore, 'utf8');
  if (!/\.env\b/.test(text)) problems.push('.dockerignore should exclude .env so secrets stay out of the Docker build context');
}

const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
for (const entry of ['node_modules/', '.env', '.env.local', 'back/uploads/']) {
  if (!gitignore.includes(entry)) problems.push(`.gitignore should contain: ${entry}`);
}

const sourceFiles = ['front/src', 'back/src'].flatMap((d) => walk(path.join(root, d))).filter((p) => /\.(ts|tsx)$/.test(p));
for (const p of sourceFiles) {
  const text = fs.readFileSync(p, 'utf8');
  if (/sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_\-]{20,}/.test(text)) problems.push(`Possible AI provider key committed in ${path.relative(root, p)}`);
  if (/re_[A-Za-z0-9_-]{20,}/.test(text)) problems.push(`Possible Resend key committed in ${path.relative(root, p)}`);
}

// The portal signing secret must be documented in the env templates, and its absence from the local
// configuration is reported (names only: no value is read out or printed).
for (const rel of ['back/.env.example', '.env.example']) {
  const abs = path.join(root, rel);
  if (fs.existsSync(abs) && !/^PORTAL_TOKEN_SECRET=/m.test(fs.readFileSync(abs, 'utf8'))) problems.push(`${rel} should document PORTAL_TOKEN_SECRET (secret signing the company portal links)`);
}
const notes = [];
const backEnv = path.join(root, 'back/.env');
if (fs.existsSync(backEnv)) {
  const defined = (name) => new RegExp(`^${name}=["']?[^"'\\s#]`, 'm').test(fs.readFileSync(backEnv, 'utf8'));
  if (!defined('PORTAL_TOKEN_SECRET')) notes.push(defined('PUBLIC_APP_URL')
    ? 'back/.env sets PUBLIC_APP_URL but not PORTAL_TOKEN_SECRET: the API will refuse to start. Set PORTAL_TOKEN_SECRET.'
    : 'PORTAL_TOKEN_SECRET is not set in back/.env. This is fine for local development (a development key is used), but it MUST be configured in production, where company portal links are used: the API refuses to start without it when NODE_ENV="production" or PUBLIC_APP_URL is set.');
}

if (problems.length) {
  console.error('\nSOWEN preflight failed:\n');
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
for (const note of notes) console.warn(`SOWEN preflight note: ${note}`);
console.log(`SOWEN preflight passed: release tree, secret-file exclusion and upload ignore rules look correct. (${secretFiles.length} local secret file(s) present and excluded from the release)`);
