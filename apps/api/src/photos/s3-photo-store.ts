import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { AppConfig } from '../config/config.js';
import { PhotoNotFoundError, type PhotoStore } from './photo-store.js';

type S3Settings = Pick<AppConfig, 's3Endpoint' | 's3Region' | 's3Bucket' | 's3AccessKeyId' | 's3SecretAccessKey'>;

/** Keeps photos in any S3-compatible storage: Amazon S3, Cloudflare R2, or SeaweedFS locally. */
export class S3PhotoStore implements PhotoStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(settings: S3Settings) {
    this.bucket = settings.s3Bucket;
    this.client = new S3Client({
      region: settings.s3Region,
      ...(settings.s3Endpoint ? { endpoint: settings.s3Endpoint, forcePathStyle: true } : {}),
      ...(settings.s3AccessKeyId && settings.s3SecretAccessKey
        ? { credentials: { accessKeyId: settings.s3AccessKeyId, secretAccessKey: settings.s3SecretAccessKey } }
        : {}),
    });
  }

  /** Creates the bucket if it does not exist yet. Used for local development and tests. */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (!(error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)) throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async put(key: string, jpeg: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: jpeg, ContentType: 'image/jpeg' }));
  }

  async get(key: string): Promise<Buffer> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return Buffer.from(await response.Body!.transformToByteArray());
    } catch (error) {
      if (error instanceof NoSuchKey) throw new PhotoNotFoundError(key);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Lets Nest close open connections on shutdown. */
  onModuleDestroy(): void {
    this.client.destroy();
  }
}
