// One-off migration of existing local files to the configured S3-compatible bucket.
//
//   npm --workspace back run storage:migrate -- --dry-run     preview, changes nothing
//   npm --workspace back run storage:migrate                  upload, then update the database
//
// Reads back/.env. Requires STORAGE_PROVIDER="s3" with the S3_* settings. Local files are never deleted.
// Safe to run again: records already migrated are skipped.
import { PrismaClient } from '@prisma/client';
import { LocalStorage } from '../src/storage/local-storage';
import { S3Storage } from '../src/storage/s3-storage';
import { migrateStoredFiles } from '../src/storage/migrate';
import { resolveStorageConfig } from '../src/storage/storage.service';

async function main() {
  // Variables already set in the environment win over back/.env.
  try { process.loadEnvFile('.env'); } catch { /* no .env file: rely on the environment */ }
  const dryRun = process.argv.includes('--dry-run');
  const config = resolveStorageConfig(key => process.env[key]);
  if (config.provider !== 's3' || !config.s3) {
    console.error(`Migration needs STORAGE_PROVIDER="s3" and a complete S3 configuration.${config.missing.length ? ` Missing: ${config.missing.join(', ')}.` : ''}`);
    process.exit(1);
  }
  const target = new S3Storage(config.s3);
  const reachable = await target.check();
  if (!reachable.ok) { console.error(`The bucket is not reachable: ${reachable.detail}`); process.exit(1); }

  const prisma = new PrismaClient();
  try {
    const report = await migrateStoredFiles({ db: prisma as any, source: new LocalStorage(config.localDir), target, localRoot: config.localDir, dryRun });
    console.log(`${dryRun ? 'DRY RUN - nothing was uploaded or changed' : 'MIGRATION'}: ${report.total} document record(s), local folder ${config.localDir}`);
    for (const item of report.items) console.log(`  ${item.outcome.padEnd(16)} ${item.name}${item.key ? `  ->  ${item.key}` : ''}${item.detail ? `  (${item.detail})` : ''}`);
    console.log(`Summary: ${Object.entries(report.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (report.orphanedLocalFiles.length) {
      console.log(`Local files with no document record (left untouched): ${report.orphanedLocalFiles.length}`);
      for (const file of report.orphanedLocalFiles) console.log(`  ${file}`);
    }
    if (report.counts.failed || report.counts.missing) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error?.message || error); process.exit(1); });
