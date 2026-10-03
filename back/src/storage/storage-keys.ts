// Storage keys are provider-independent identifiers such as "<projectId>/reports/1712345678-rapport.pdf".
// The same key addresses a file under the local uploads folder or an object in an S3 bucket.

export type StorageFolder = 'documents' | 'evidence' | 'reports';

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_').slice(-140);
  return cleaned || 'fichier';
}

export function buildKey(projectId: string, folder: StorageFolder, originalName: string, now: number = Date.now()): string {
  const file = `${now}-${safeFileName(originalName)}`;
  // Project documents keep their historical place at the project root; evidence and reports have a sub-folder.
  return folder === 'documents' ? `${projectId}/${file}` : `${projectId}/${folder}/${file}`;
}

// Records created before the storage layer hold an absolute path (C:\...\back\uploads\<key> or /app/uploads/<key>).
export function isLegacyPath(stored: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(stored) || stored.startsWith('/') || stored.startsWith('\\\\');
}

// Turns what the database holds into a storage key. A legacy absolute path is reduced to the part after "uploads".
// Returns null when the value cannot be a valid key (empty, or trying to leave the storage root).
export function toStorageKey(stored: string | null | undefined): string | null {
  if (!stored) return null;
  let key = stored.replace(/\\/g, '/');
  if (isLegacyPath(stored)) {
    const marker = key.lastIndexOf('/uploads/');
    if (marker < 0) return null;
    key = key.slice(marker + '/uploads/'.length);
  }
  key = key.replace(/^\/+/, '');
  if (!key || key.split('/').some(part => part === '..' || part === '.' || part === '')) return null;
  return key;
}
