import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import path from 'path';
import { LocalStorage } from './local-storage';
import { S3Settings, S3Storage } from './s3-storage';
import { StorageFolder, buildKey, toStorageKey } from './storage-keys';
import { StorageNotFoundError, StorageProvider, StorageProviderName } from './storage.types';

export type StorageState = 'local' | 'object' | 'misconfigured' | 'error';
export type StorageStatus = { provider: StorageProviderName; state: StorageState; ok: boolean; detail: string | null };

const S3_REQUIRED = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
const STATUS_TTL_MS = 60 * 1000;

// Reads STORAGE_PROVIDER and the S3_* settings. Pure, so it can be tested and reused by the migration script.
export function resolveStorageConfig(get: (key: string) => string | undefined): { provider: StorageProviderName; missing: string[]; unknownProvider: string | null; s3: S3Settings | null; localDir: string } {
  const value = (key: string) => (get(key) || '').trim();
  const requested = value('STORAGE_PROVIDER').toLowerCase();
  const provider: StorageProviderName = requested === 's3' ? 's3' : 'local';
  const unknownProvider = requested && requested !== 's3' && requested !== 'local' ? requested : null;
  const missing = provider === 's3' ? S3_REQUIRED.filter(key => !value(key)) : [];
  const endpoint = value('S3_ENDPOINT');
  const forced = value('S3_FORCE_PATH_STYLE').toLowerCase();
  const s3: S3Settings | null = provider === 's3' && !missing.length ? {
    endpoint: endpoint || undefined,
    region: value('S3_REGION') || 'auto',
    bucket: value('S3_BUCKET'),
    accessKeyId: value('S3_ACCESS_KEY_ID'),
    secretAccessKey: value('S3_SECRET_ACCESS_KEY'),
    // Path-style addressing works with every S3-compatible endpoint; AWS itself (no endpoint) uses virtual hosts.
    forcePathStyle: forced ? forced === 'true' : Boolean(endpoint),
  } : null;
  return { provider, missing, unknownProvider, s3, localDir: value('STORAGE_LOCAL_DIR') || path.resolve(process.cwd(), 'uploads') };
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly provider: StorageProvider | null;
  private readonly providerName: StorageProviderName;
  private readonly configError: string | null;
  private cachedStatus: { at: number; value: StorageStatus } | null = null;

  constructor(config: ConfigService) {
    const resolved = resolveStorageConfig(key => config.get<string>(key));
    this.providerName = resolved.provider;
    if (resolved.unknownProvider) {
      // An unknown value must not silently become local storage.
      this.provider = null;
      this.configError = `STORAGE_PROVIDER has an unknown value ("${resolved.unknownProvider}"); use "local" or "s3"`;
    } else if (resolved.provider === 's3' && !resolved.s3) {
      this.provider = null;
      this.configError = `Object storage is selected but not fully configured (missing: ${resolved.missing.join(', ')})`;
    } else {
      this.provider = resolved.s3 ? new S3Storage(resolved.s3) : new LocalStorage(resolved.localDir);
      this.configError = null;
    }
    if (this.configError) this.logger.error(this.configError);
    else this.logger.log(`Document storage: ${this.providerName === 's3' ? 'S3-compatible object storage' : 'local folder'}`);
  }

  private active(): StorageProvider {
    if (!this.provider) throw new ServiceUnavailableException('Le stockage des documents est mal configuré. Contactez un administrateur.');
    return this.provider;
  }

  // Stores a new file and returns the key to keep in the database.
  async save(input: { projectId: string; folder: StorageFolder; originalName: string; buffer: Buffer; contentType?: string | null }): Promise<string> {
    const key = buildKey(input.projectId, input.folder, input.originalName);
    await this.active().put(key, input.buffer, input.contentType);
    return key;
  }

  // Reads the file behind a stored value (a key, or a legacy absolute path).
  async read(stored: string | null | undefined): Promise<Buffer> {
    const key = toStorageKey(stored);
    if (!key) throw new NotFoundException('Fichier introuvable');
    try {
      return await this.active().get(key);
    } catch (error) {
      if (error instanceof StorageNotFoundError) throw new NotFoundException('Fichier introuvable');
      throw error;
    }
  }

  // Removes a stored file. Never throws: returns false and logs when the file could not be removed,
  // so the caller can report the leftover instead of failing after the database change.
  async remove(stored: string | null | undefined): Promise<boolean> {
    const key = toStorageKey(stored);
    if (!key) return true;
    try {
      await this.active().delete(key);
      return true;
    } catch (error: any) {
      this.logger.error(`Stored file could not be removed and is now orphaned: ${key} (${error?.name || error?.message || 'error'})`);
      return false;
    }
  }

  async exists(stored: string | null | undefined): Promise<boolean> {
    const key = toStorageKey(stored);
    return key ? this.active().exists(key) : false;
  }

  // What Settings shows: which provider is selected and whether it really works. Cached for a minute.
  async status(): Promise<StorageStatus> {
    if (this.cachedStatus && Date.now() - this.cachedStatus.at < STATUS_TTL_MS) return this.cachedStatus.value;
    let value: StorageStatus;
    if (!this.provider) value = { provider: this.providerName, state: 'misconfigured', ok: false, detail: this.configError };
    else {
      const result = await this.provider.check();
      value = result.ok
        ? { provider: this.providerName, state: this.providerName === 's3' ? 'object' : 'local', ok: true, detail: null }
        : { provider: this.providerName, state: 'error', ok: false, detail: result.detail || 'Storage is not reachable' };
    }
    this.cachedStatus = { at: Date.now(), value };
    return value;
  }
}
