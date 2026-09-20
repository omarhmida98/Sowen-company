import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'package.json', 'docker-compose.yml', 'back/.env.example', 'front/.env.example',
  'back/prisma/schema.prisma', 'front/src/app/login/page.tsx', 'front/src/app/register/page.tsx',
];
const problems = [];
for (const rel of required) {
  if (!fs.existsSync(path.join(root, rel))) problems.push(`Missing required file: ${rel}`);
}

const forbiddenFiles = ['back/.env', 'front/.env.local'];
for (const rel of forbiddenFiles) {
  if (fs.existsSync(path.join(root, rel))) problems.push(`Local secret file present in release tree: ${rel}`);
}

const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
for (const entry of ['node_modules/', '.env', '.env.local', 'back/uploads/']) {
  if (!gitignore.includes(entry)) problems.push(`.gitignore should contain: ${entry}`);
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', 'dist'].includes(ent.name)) continue;
    const p = path.join(dir, ent.name);
    ent.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

const sourceFiles = ['front/src', 'back/src'].flatMap((d) => walk(path.join(root, d))).filter((p) => /\.(ts|tsx)$/.test(p));
for (const p of sourceFiles) {
  const text = fs.readFileSync(p, 'utf8');
  if (/sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_\-]{20,}/.test(text)) problems.push(`Possible AI provider key committed in ${path.relative(root, p)}`);
  if (/re_[A-Za-z0-9_-]{20,}/.test(text)) problems.push(`Possible Resend key committed in ${path.relative(root, p)}`);
}

if (problems.length) {
  console.error('\nSOWEN preflight failed:\n');
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
console.log('SOWEN preflight passed: release tree, secret-file checks and upload ignore rules look correct.');
