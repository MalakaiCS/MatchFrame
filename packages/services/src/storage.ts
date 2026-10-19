// Private S3-compatible object storage. All keys are scoped by organisation and opaque IDs.
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '@bs/config';
import fs from 'node:fs';
import type { Readable } from 'node:stream';

export interface Storage {
  bucket: string;
  client: S3Client;
  ensureBucket(): Promise<void>;
  put(key: string, body: Buffer | Readable | string, contentType: string, contentLength?: number): Promise<void>;
  putFile(key: string, path: string, contentType: string): Promise<number>;
  get(key: string, range?: string): Promise<{ body: Readable; contentType?: string; contentLength?: number; contentRange?: string; etag?: string }>;
  getBuffer(key: string): Promise<Buffer>;
  download(key: string, path: string): Promise<void>;
  head(key: string): Promise<{ contentLength: number; contentType?: string } | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<{ key: string; size: number }[]>;
  presignPut(key: string, contentType: string, contentLength: number, ttlSeconds?: number): Promise<string>;
}

export const keys = {
  assetOriginal: (org: string, asset: string) => `org/${org}/assets/${asset}/original`,
  assetDerivative: (org: string, asset: string, purpose: string, ext: string) => `org/${org}/assets/${asset}/${purpose}.${ext}`,
  recordingPrefix: (org: string, rec: string) => `org/${org}/recordings/${rec}/`,
  clip: (org: string, clip: string) => `org/${org}/clips/${clip}.mp4`,
  clipThumb: (org: string, clip: string) => `org/${org}/clips/${clip}.jpg`,
  export: (org: string, job: string) => `org/${org}/exports/${job}.mp4`,
};

export function createStorage(cfg: AppConfig): Storage {
  const client = new S3Client({
    endpoint: cfg.S3_ENDPOINT,
    region: cfg.S3_REGION,
    forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: cfg.S3_ACCESS_KEY, secretAccessKey: cfg.S3_SECRET_KEY },
  });
  const Bucket = cfg.S3_BUCKET;
  const s: Storage = {
    bucket: Bucket,
    client,
    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
      } catch {
        await client.send(new CreateBucketCommand({ Bucket }));
      }
      // Explicitly private: deny anonymous reads.
      await client
        .send(
          new PutBucketPolicyCommand({
            Bucket,
            Policy: JSON.stringify({
              Version: '2012-10-17',
              Statement: [{ Effect: 'Deny', Principal: '*', Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${Bucket}/*`], Condition: { StringEquals: { 'aws:PrincipalType': 'Anonymous' } } }],
            }),
          }),
        )
        .catch(() => undefined);
    },
    async put(key, body, contentType, contentLength) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType, ContentLength: contentLength }));
    },
    async putFile(key, path, contentType) {
      const size = fs.statSync(path).size;
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: fs.createReadStream(path), ContentType: contentType, ContentLength: size }));
      return size;
    },
    async get(key, range) {
      const r = await client.send(new GetObjectCommand({ Bucket, Key: key, Range: range }));
      return { body: r.Body as Readable, contentType: r.ContentType, contentLength: r.ContentLength, contentRange: r.ContentRange, etag: r.ETag };
    },
    async getBuffer(key) {
      const r = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    },
    async download(key, path) {
      const r = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      await new Promise<void>((resolve, reject) => {
        const w = fs.createWriteStream(path);
        (r.Body as Readable).pipe(w).on('finish', () => resolve()).on('error', reject);
      });
    },
    async head(key) {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { contentLength: r.ContentLength ?? 0, contentType: r.ContentType };
      } catch {
        return null;
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async list(prefix) {
      const out: { key: string; size: number }[] = [];
      let token: string | undefined;
      do {
        const r = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
        for (const o of r.Contents ?? []) out.push({ key: o.Key!, size: o.Size ?? 0 });
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
    async presignPut(key, contentType, contentLength, ttlSeconds = 900) {
      return getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: contentLength }), {
        expiresIn: ttlSeconds,
        signableHeaders: new Set(['content-type', 'content-length']),
      });
    },
  };
  return s;
}
