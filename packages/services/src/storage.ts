// Private S3-compatible object storage. All keys are scoped by organisation and opaque IDs.
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '@bs/config';
import { mediaBlobs, withTenant, type Db } from '@bs/db';
import { and, eq, like } from 'drizzle-orm';
import fs from 'node:fs';
import { Readable } from 'node:stream';

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
  /** a short-lived read URL (FFmpeg reads a match video in place, seeking with range requests) */
  presignGet(key: string, ttlSeconds?: number): Promise<string>;
  /** large files in parts: start, send each part (its ETag back), complete in order or abort */
  createMultipart(key: string, contentType: string): Promise<string>;
  uploadPart(key: string, uploadId: string, partNumber: number, body: Readable | Buffer, contentLength: number): Promise<string>;
  completeMultipart(key: string, uploadId: string, etags: string[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
}

export const keys = {
  assetOriginal: (org: string, asset: string) => `org/${org}/assets/${asset}/original`,
  assetDerivative: (org: string, asset: string, purpose: string, ext: string) => `org/${org}/assets/${asset}/${purpose}.${ext}`,
  recordingPrefix: (org: string, rec: string) => `org/${org}/recordings/${rec}/`,
  clip: (org: string, clip: string) => `org/${org}/clips/${clip}.mp4`,
  clipThumb: (org: string, clip: string) => `org/${org}/clips/${clip}.jpg`,
  export: (org: string, job: string) => `org/${org}/exports/${job}.mp4`,
  matchVideo: (org: string, video: string) => `org/${org}/match-videos/${video}/original`,
  matchVideoProxy: (org: string, video: string) => `org/${org}/match-videos/${video}/proxy.mp4`,
  matchVideoThumb: (org: string, video: string) => `org/${org}/match-videos/${video}/thumb.jpg`,
  highlightOverlay: (org: string, job: string) => `org/${org}/exports/${job}-overlay.bin`,
};

/** Files up to this size can be kept in the database when object storage cannot take them. */
export const DB_FALLBACK_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Object storage. With `db`, small files (images, logos, fonts: up to 25 MB) are kept in the database when the
 * object store refuses them or cannot be reached, and every read looks there when the store does not have the
 * key, so uploads work on a host with no working object storage. Larger files (video, recordings) need the store.
 */
export function createStorage(cfg: AppConfig, opts: { db?: Db } = {}): Storage {
  const client = new S3Client({
    endpoint: cfg.S3_ENDPOINT,
    region: cfg.S3_REGION,
    forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: cfg.S3_ACCESS_KEY, secretAccessKey: cfg.S3_SECRET_KEY },
    // fail fast when the store is unreachable, so the fallback answers instead of a hung request
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 60_000 },
    maxAttempts: 2,
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
    async presignGet(key, ttlSeconds = 3600) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: ttlSeconds });
    },
    async createMultipart(key, contentType) {
      const r = await client.send(new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType }));
      return r.UploadId!;
    },
    async uploadPart(key, uploadId, partNumber, body, contentLength) {
      const r = await client.send(new UploadPartCommand({ Bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, Body: body, ContentLength: contentLength }));
      return r.ETag!;
    },
    async completeMultipart(key, uploadId, etags) {
      await client.send(new CompleteMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: etags.map((ETag, i) => ({ ETag, PartNumber: i + 1 })) } }));
    },
    async abortMultipart(key, uploadId) {
      await client.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId }));
    },
  };
  return opts.db ? withDatabaseFallback(s, opts.db) : s;
}

const orgOfKey = (key: string) => /^org\/([0-9a-f-]{36})\//.exec(key)?.[1] ?? null;

async function toBuffer(body: Buffer | Readable | string): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  const parts: Buffer[] = [];
  let n = 0;
  for await (const c of body) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array);
    n += b.length;
    if (n > DB_FALLBACK_MAX_BYTES) throw new Error('File too large to keep without object storage');
    parts.push(b);
  }
  return Buffer.concat(parts);
}

/** The object store first; the database for small files it cannot take, and for reads of keys it does not have. */
function withDatabaseFallback(s3: Storage, db: Db): Storage {
  const blob = async (key: string) => {
    const org = orgOfKey(key);
    if (!org) return null;
    const [b] = await withTenant(db, { organisationId: org }, (t) => t.select().from(mediaBlobs).where(and(eq(mediaBlobs.organisationId, org), eq(mediaBlobs.key, key))));
    return b ?? null;
  };
  const keep = async (key: string, data: Buffer, contentType: string) => {
    const org = orgOfKey(key);
    if (!org || data.length > DB_FALLBACK_MAX_BYTES) return false;
    await withTenant(db, { organisationId: org }, (t) =>
      t.insert(mediaBlobs).values({ key, organisationId: org, contentType, bytes: data.length, data }).onConflictDoUpdate({ target: mediaBlobs.key, set: { contentType, bytes: data.length, data, createdAt: new Date() } }),
    );
    return true;
  };
  const readOr = async <T>(key: string, fromStore: () => Promise<T>, fromBlob: (b: NonNullable<Awaited<ReturnType<typeof blob>>>) => T | Promise<T>): Promise<T> => {
    try {
      return await fromStore();
    } catch (e) {
      const b = await blob(key).catch(() => null);
      if (b) return fromBlob(b);
      throw e;
    }
  };
  return {
    ...s3,
    async ensureBucket() {
      await s3.ensureBucket();
    },
    async put(key, body, contentType, contentLength) {
      // small files are buffered so the same bytes can go to the database if the store refuses them
      const small = orgOfKey(key) && (typeof body === 'string' || Buffer.isBuffer(body) || (contentLength ?? Infinity) <= DB_FALLBACK_MAX_BYTES);
      if (!small) return s3.put(key, body, contentType, contentLength);
      const data = await toBuffer(body);
      try {
        await s3.put(key, data, contentType, data.length);
      } catch (e) {
        if (!(await keep(key, data, contentType))) throw e;
      }
    },
    async putFile(key, path, contentType) {
      try {
        return await s3.putFile(key, path, contentType);
      } catch (e) {
        const size = fs.statSync(path).size;
        if (size > DB_FALLBACK_MAX_BYTES || !(await keep(key, fs.readFileSync(path), contentType))) throw e;
        return size;
      }
    },
    get: (key, range) => readOr(key, () => s3.get(key, range), (b) => ({ body: Readable.from(b.data), contentType: b.contentType, contentLength: b.bytes, etag: `"db-${b.bytes}-${b.createdAt.getTime()}"` })),
    getBuffer: (key) => readOr(key, () => s3.getBuffer(key), (b) => Buffer.from(b.data)),
    download: (key, path) => readOr(key, () => s3.download(key, path), (b) => fs.writeFileSync(path, b.data)),
    async head(key) {
      const h = await s3.head(key);
      if (h) return h;
      const b = await blob(key).catch(() => null);
      return b ? { contentLength: b.bytes, contentType: b.contentType } : null;
    },
    async delete(key) {
      await s3.delete(key).catch(() => undefined);
      const org = orgOfKey(key);
      if (org) await withTenant(db, { organisationId: org }, (t) => t.delete(mediaBlobs).where(and(eq(mediaBlobs.organisationId, org), eq(mediaBlobs.key, key))));
    },
    async list(prefix) {
      const out = await s3.list(prefix).catch(() => [] as { key: string; size: number }[]);
      const org = orgOfKey(prefix);
      if (!org) return out;
      const rows = await withTenant(db, { organisationId: org }, (t) => t.select({ key: mediaBlobs.key, size: mediaBlobs.bytes }).from(mediaBlobs).where(and(eq(mediaBlobs.organisationId, org), like(mediaBlobs.key, `${prefix.replace(/[%_\\]/g, '\\$&')}%`))));
      const seen = new Set(out.map((o) => o.key));
      return [...out, ...rows.filter((r) => !seen.has(r.key))];
    },
  };
}
