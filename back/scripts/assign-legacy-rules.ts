// Attributes rules created before the per-organisation library to an organisation chosen by the operator.
//
//   npm --workspace back run rules:assign-legacy                                     list, changes nothing
//   npm --workspace back run rules:assign-legacy -- --organization <id>              attribute every rule without organisation
//   npm --workspace back run rules:assign-legacy -- --organization <id> --rules a,b  attribute only these rules
//
// Reads back/.env. Only needed when "prisma migrate deploy" stopped on rules_organization_required.
// The organisation is always given explicitly: nothing is guessed, and no rule is deleted or modified otherwise.
import { PrismaClient } from '@prisma/client';

const option = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] || '') : null; };

async function main() {
  // Variables already set in the environment win over back/.env.
  try { process.loadEnvFile('.env'); } catch { /* no .env file: rely on the environment */ }
  const organizationId = option('--organization');
  const only = option('--rules')?.split(',').map(x => x.trim()).filter(Boolean) || null;
  if (organizationId === '' || (only && !only.length)) { console.error('Usage: rules:assign-legacy [-- --organization <organisation id> [--rules <rule id>,<rule id>]]'); process.exit(1); }
  if (only && !organizationId) { console.error('--rules needs --organization <organisation id>.'); process.exit(1); }

  const prisma = new PrismaClient();
  try {
    // Raw SQL: for the application a rule without organisation does not exist.
    const nullable = await prisma.$queryRaw<{ is_nullable: string }[]>`SELECT is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Rule' AND column_name = 'organizationId'`;
    if (!nullable.length) { console.error('The rules table has no organisation column yet: run "npx prisma migrate deploy" first.'); process.exit(1); }
    const legacy = await prisma.$queryRaw<{ id: string; title: string; domain: string; active: boolean; createdAt: Date }[]>`SELECT "id", "title", "domain", "active", "createdAt" FROM "Rule" WHERE "organizationId" IS NULL ORDER BY "createdAt", "title"`;
    if (!legacy.length) { console.log('No rule without organisation: nothing to do.'); return; }
    const organizations = await prisma.organization.findMany({ select: { id: true, name: true, createdAt: true }, orderBy: { createdAt: 'asc' } });

    if (!organizationId) {
      console.log(`${legacy.length} rule(s) without organisation (not visible to anyone until attributed):`);
      for (const r of legacy) console.log(`  ${r.id}  ${r.active ? 'active  ' : 'inactive'}  [${r.domain}] ${r.title}`);
      console.log(`\n${organizations.length} organisation(s):`);
      for (const o of organizations) console.log(`  ${o.id}  ${o.name}`);
      console.log('\nNothing was changed. Choose the organisation that owns these rules and run again with --organization <organisation id>.');
      process.exitCode = 2;
      return;
    }

    const organization = organizations.find(o => o.id === organizationId);
    if (!organization) { console.error(`Unknown organisation: ${organizationId}. Run without option to list the organisations.`); process.exit(1); }
    const ids = only || legacy.map(r => r.id);
    const unknown = ids.filter(id => !legacy.some(r => r.id === id));
    if (unknown.length) { console.error(`Not a rule without organisation: ${unknown.join(', ')}. Nothing was changed.`); process.exit(1); }
    // The condition on NULL is repeated in the statement: a rule that already has an organisation is never moved.
    const updated = await prisma.$executeRaw`UPDATE "Rule" SET "organizationId" = ${organization.id} WHERE "organizationId" IS NULL AND "id" = ANY(${ids})`;
    const remaining = legacy.length - updated;
    console.log(`${updated} rule(s) attributed to "${organization.name}".`);
    if (remaining) { console.log(`${remaining} rule(s) still without organisation: run again for them.`); process.exitCode = 2; return; }
    console.log('Every rule now has an organisation. Finish the deployment with:');
    console.log('  npx prisma migrate resolve --rolled-back 20261003230000_rules_organization_required   (only if that migration failed)');
    console.log('  npx prisma migrate deploy');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error?.message || error); process.exit(1); });
