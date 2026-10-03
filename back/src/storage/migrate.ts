import { promises as fs } from 'fs';
import path from 'path';
import { isLegacyPath, toStorageKey } from './storage-keys';
import { StorageNotFoundError, StorageProvider } from './storage.types';

// Copies existing local files to the target storage and rewrites the stored keys.
// Safe to rerun: a record already pointing to an object that exists in the target is left alone.
// Local files are never deleted, and with dryRun nothing is uploaded and nothing is written.

export type MigrationOutcome = 'migrated' | 'already-migrated' | 'relinked' | 'missing' | 'invalid-key' | 'failed';
export type MigrationItem = { documentId: string; name: string; storedAs: string; key: string | null; outcome: MigrationOutcome; detail?: string };
export type MigrationReport = { dryRun: boolean; total: number; counts: Record<MigrationOutcome, number>; items: MigrationItem[]; orphanedLocalFiles: string[] };

type DocumentRow = { id: string; name: string; storageKey: string; mimeType: string | null };
export type MigrationDatabase = {
  document: {
    findMany(args: { select: { id: true; name: true; storageKey: true; mimeType: true }; orderBy: { uploadedAt: 'asc' } }): Promise<DocumentRow[]>;
    update(args: { where: { id: string }; data: { storageKey: string } }): Promise<unknown>;
  };
};

async function listLocalFiles(root: string, dir = root): Promise<string[]> {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listLocalFiles(root, full)));
    else if (entry.isFile()) files.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return files;
}

export async function migrateStoredFiles(options: { db: MigrationDatabase; source: StorageProvider; target: StorageProvider; localRoot: string; dryRun: boolean }): Promise<MigrationReport> {
  const { db, source, target, dryRun } = options;
  const documents = await db.document.findMany({ select: { id: true, name: true, storageKey: true, mimeType: true }, orderBy: { uploadedAt: 'asc' } });
  const counts: Record<MigrationOutcome, number> = { migrated: 0, 'already-migrated': 0, relinked: 0, missing: 0, 'invalid-key': 0, failed: 0 };
  const items: MigrationItem[] = [];
  const referenced = new Set<string>();

  for (const doc of documents) {
    const key = toStorageKey(doc.storageKey);
    const item: MigrationItem = { documentId: doc.id, name: doc.name, storedAs: isLegacyPath(doc.storageKey) ? 'absolute local path' : 'storage key', key, outcome: 'failed' };
    items.push(item);
    if (!key) { item.outcome = 'invalid-key'; item.detail = 'the stored value cannot be turned into a storage key'; counts['invalid-key']++; continue; }
    referenced.add(key);
    try {
      const needsNewKey = doc.storageKey !== key;
      const inTarget = await target.exists(key);
      if (inTarget && !needsNewKey) { item.outcome = 'already-migrated'; counts['already-migrated']++; continue; }
      if (!inTarget) {
        let body: Buffer;
        try { body = await source.get(key); }
        catch (error) {
          if (error instanceof StorageNotFoundError) { item.outcome = 'missing'; item.detail = 'no local file for this record'; counts.missing++; continue; }
          throw error;
        }
        if (!dryRun) {
          await target.put(key, body, doc.mimeType);
          // The database is only changed once the object is confirmed to be in the target.
          if (!(await target.exists(key))) throw new Error('upload could not be verified');
        }
      }
      if (needsNewKey && !dryRun) await db.document.update({ where: { id: doc.id }, data: { storageKey: key } });
      item.outcome = inTarget ? 'relinked' : 'migrated';
      counts[item.outcome]++;
    } catch (error: any) {
      item.outcome = 'failed';
      item.detail = error?.name && error.name !== 'Error' ? error.name : error?.message || 'error';
      counts.failed++;
    }
  }

  const orphanedLocalFiles = (await listLocalFiles(path.resolve(options.localRoot))).filter(file => !referenced.has(file));
  return { dryRun, total: documents.length, counts, items, orphanedLocalFiles };
}
