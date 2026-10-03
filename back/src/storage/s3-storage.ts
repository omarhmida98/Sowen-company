import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { StorageNotFoundError, StorageProvider } from './storage.types';

export type S3Settings = { endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean };

// The only thing this class needs from the SDK client; lets tests substitute a fake.
export type S3Sender = { send(command: any): Promise<any> };

const isMissing = (error: any) => error?.name === 'NoSuchKey' || error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404;

// Any S3-compatible object storage (OVH Object Storage, Cloudflare R2, AWS S3...). Objects are private:
// nothing here sets a public ACL or produces a public or signed URL; files are only served through the API.
export class S3Storage implements StorageProvider {
  readonly name = 's3' as const;
  private readonly client: S3Sender;

  constructor(private readonly settings: S3Settings, client?: S3Sender) {
    this.client = client ?? new S3Client({
      region: settings.region,
      ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
      forcePathStyle: settings.forcePathStyle,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      // Newer SDK versions add CRC32 checksums to every request by default, which several
      // S3-compatible providers reject. Only send them when an operation requires it.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async put(key: string, body: Buffer, contentType?: string | null): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.settings.bucket, Key: key, Body: body, ContentLength: body.length, ...(contentType ? { ContentType: contentType } : {}) }));
  }

  async get(key: string): Promise<Buffer> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.settings.bucket, Key: key }));
      if (!result?.Body) throw new StorageNotFoundError(key);
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error: any) {
      if (error instanceof StorageNotFoundError || isMissing(error)) throw new StorageNotFoundError(key);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.settings.bucket, Key: key }));
      return true;
    } catch (error: any) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  async check(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.settings.bucket }));
      return { ok: true };
    } catch (error: any) {
      const status = error?.$metadata?.httpStatusCode;
      const named = error?.name && error.name !== 'Error' ? String(error.name) : null;
      const reason = status === 403 ? 'access denied' : status === 404 ? 'bucket not found' : status ? `refused (HTTP ${status})` : named && !/timeout/i.test(named) ? named : 'endpoint unreachable';
      // The reason is a short label: never the endpoint, the keys or the provider's raw answer.
      return { ok: false, detail: `Object storage check failed: ${reason}` };
    }
  }
}
