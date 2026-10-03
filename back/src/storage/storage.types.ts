export type StorageProviderName = 'local' | 's3';

// Thrown by a provider when the key has no file behind it.
export class StorageNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Stored file not found: ${key}`);
  }
}

// One implementation per backend. Keys are provider-independent (see storage-keys.ts).
export interface StorageProvider {
  readonly name: StorageProviderName;
  put(key: string, body: Buffer, contentType?: string | null): Promise<void>;
  get(key: string): Promise<Buffer>;
  // Deleting a key that does not exist is not an error.
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  // Cheap reachability test, used for the status shown in Settings. Never throws.
  check(): Promise<{ ok: boolean; detail?: string }>;
}
