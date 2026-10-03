import { promises as fs } from 'fs';
import path from 'path';
import { StorageNotFoundError, StorageProvider } from './storage.types';

// Files on the server's disk, under one root folder (back/uploads by default). Meant for development.
export class LocalStorage implements StorageProvider {
  readonly name = 'local' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  // Keys always resolve inside the root: anything else is refused.
  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) throw new Error(`Storage key outside the storage root: ${key}`);
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.resolve(key));
    } catch (error: any) {
      if (error?.code === 'ENOENT' || error?.code === 'EISDIR') throw new StorageNotFoundError(key);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try { return (await fs.stat(this.resolve(key))).isFile(); } catch { return false; }
  }

  async check(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await fs.mkdir(this.root, { recursive: true });
      await fs.access(this.root);
      return { ok: true };
    } catch (error: any) {
      return { ok: false, detail: `Local storage folder is not writable (${error?.code || 'error'})` };
    }
  }
}
