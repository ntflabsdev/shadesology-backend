'use strict';

/**
 * S3 Service — dual-bucket wrapper for Shadesology.
 *
 * PUBLIC BUCKET  (S3_BUCKET_PUBLIC)   → CMS media, product images.
 *                                       Files are publicly readable via S3_PUBLIC_BASE_URL.
 *
 * PRIVATE BUCKET (S3_BUCKET_PRIVATE)  → Customer photos, drawings, gated documents,
 *                                       quote PDFs, production exports.
 *                                       Block Public Access = ON.
 *                                       Files are ONLY served through short-lived signed URLs
 *                                       after an access check in the calling route/controller.
 *
 * Key naming convention:
 *   {env}/{domain}/{id}/{uuid}-{sanitised-filename}
 *   e.g. development/products/507f.../a1b2c3-cassita-spec.pdf
 *
 * Usage:
 *   const s3 = require('./s3');
 *   const { key, url } = await s3.uploadPublic(buffer, 'image/jpeg', 'products', 'abc123', 'hero.jpg');
 *   const signedUrl    = await s3.getSignedDownloadUrl(key, 'private');
 *   await s3.deleteFile(key, 'private');
 */

const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

// ─── Validation constants ────────────────────────────────────────────────────
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_DOC_TYPES   = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream', // BIM/CAD
]);
const ALLOWED_TYPES = new Set([...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOC_TYPES]);
for (const type of [
  'image/heic',
  'image/heif',
  'application/acad',
  'image/vnd.dwg',
  'image/vnd.dxf',
  'application/dxf',
]) {
  ALLOWED_TYPES.add(type);
}

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;   // 15 MB
const MAX_DOC_BYTES   = 100 * 1024 * 1024;  // 100 MB

// ─── S3 client ───────────────────────────────────────────────────────────────
let _client = null;

function getClient() {
  if (_client) return _client;

  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'S3 not configured — set AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY in env.'
    );
  }

  _client = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  return _client;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve bucket name from a bucket alias.
 * @param {'public'|'private'} bucket
 */
function resolveBucket(bucket) {
  if (bucket === 'public') {
    const name = process.env.S3_BUCKET_PUBLIC;
    if (!name) throw new Error('S3_BUCKET_PUBLIC is not set.');
    return name;
  }
  if (bucket === 'private') {
    const name = process.env.S3_BUCKET_PRIVATE;
    if (!name) throw new Error('S3_BUCKET_PRIVATE is not set.');
    return name;
  }
  throw new Error(`Unknown bucket alias "${bucket}". Use "public" or "private".`);
}

/**
 * Sanitise a filename for use in an S3 key.
 * Removes path traversal and non-safe characters.
 */
function sanitiseFilename(filename) {
  return path
    .basename(filename)
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 120); // cap length
}

/**
 * Build an S3 object key.
 * Pattern: {env}/{domain}/{id}/{uuid}-{sanitised-filename}
 *
 * @param {string} domain     e.g. 'products', 'quotes', 'reviews'
 * @param {string} id         e.g. a MongoDB ObjectId string
 * @param {string} filename   original filename
 */
function buildKey(domain, id, filename) {
  const env      = process.env.NODE_ENV || 'development';
  const uuid     = randomUUID().replace(/-/g, '').slice(0, 12);
  const safe     = sanitiseFilename(filename);
  return `${env}/${domain}/${id}/${uuid}-${safe}`;
}

/**
 * Validate content-type and file size before upload.
 */
function validateUpload(contentType, sizeBytes) {
  if (!ALLOWED_TYPES.has(contentType)) {
    throw Object.assign(
      new Error(`File type "${contentType}" is not allowed.`),
      { statusCode: 400 }
    );
  }

  const limit = ALLOWED_IMAGE_TYPES.has(contentType) ? MAX_IMAGE_BYTES : MAX_DOC_BYTES;
  if (sizeBytes > limit) {
    const mb = Math.round(limit / 1024 / 1024);
    throw Object.assign(
      new Error(`File exceeds the ${mb} MB size limit.`),
      { statusCode: 400 }
    );
  }
}

// ─── Core upload ─────────────────────────────────────────────────────────────

/**
 * Upload a buffer or stream to S3.
 *
 * @param {Buffer}             body         File data
 * @param {string}             contentType  MIME type
 * @param {'public'|'private'} bucket       Bucket alias
 * @param {string}             domain       Key domain segment (e.g. 'products')
 * @param {string}             id           Record ID (e.g. MongoDB ObjectId)
 * @param {string}             filename     Original filename
 * @param {object}             [metadata]   Optional extra S3 metadata
 * @returns {{ key: string, url: string|null }}
 *   url is the public CDN URL for public files, null for private files.
 */
async function upload(body, contentType, bucket, domain, id, filename, metadata = {}) {
  validateUpload(contentType, Buffer.byteLength(body));

  const client     = getClient();
  const bucketName = resolveBucket(bucket);
  const key        = buildKey(domain, id, filename);

  const params = {
    Bucket:      bucketName,
    Key:         key,
    Body:        body,
    ContentType: contentType,
    Metadata:    {
      uploadedBy: metadata.uploadedBy || 'system',
      domain,
      id,
      ...metadata,
    },
  };

  // Public files: allow public-read ACL if the bucket supports it.
  // We rely on the bucket policy rather than per-object ACL to avoid
  // "access denied" when Block Public Access is off at account level.
  // Private files: no ACL — bucket-level Block Public Access handles restriction.

  await getClient().send(new PutObjectCommand(params));

  const url =
    bucket === 'public'
      ? `${(process.env.S3_PUBLIC_BASE_URL || '').replace(/\/$/, '')}/${key}`
      : null; // private files must use getSignedDownloadUrl()

  return { key, url };
}

// ─── Public convenience wrappers ─────────────────────────────────────────────

/**
 * Upload to the PUBLIC bucket.
 * Returns { key, url } where url is a permanent CDN URL.
 */
async function uploadPublic(body, contentType, domain, id, filename, metadata = {}) {
  return upload(body, contentType, 'public', domain, id, filename, metadata);
}

/**
 * Upload to the PRIVATE bucket.
 * Returns { key, url: null } — url is always null; use getSignedDownloadUrl() to serve.
 */
async function uploadPrivate(body, contentType, domain, id, filename, metadata = {}) {
  return upload(body, contentType, 'private', domain, id, filename, metadata);
}

// ─── Signed URLs ─────────────────────────────────────────────────────────────

/**
 * Generate a presigned GET URL for a private object.
 * Only call this AFTER your access-check logic has confirmed the requester
 * is authorised to access the file.
 *
 * @param {string}             key        S3 object key
 * @param {'public'|'private'} bucket     Bucket alias (almost always 'private')
 * @param {number}             [expiresIn] Seconds until expiry (default from env or 3600)
 */
async function getSignedDownloadUrl(key, bucket = 'private', expiresIn) {
  const client     = getClient();
  const bucketName = resolveBucket(bucket);
  const seconds    = expiresIn || Number(process.env.S3_SIGNED_URL_EXPIRES) || 3600;

  const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
  return getSignedUrl(client, command, { expiresIn: seconds });
}

/**
 * Generate a policy-bound POST for direct client-to-S3 upload.
 * Use this for large files (e.g. customer drawing uploads) to avoid
 * proxying through the API server.
 *
 * @param {'public'|'private'} bucket
 * @param {string}             domain
 * @param {string}             id
 * @param {string}             filename
 * @param {string}             contentType
 * @param {number}             maxBytes      Maximum object size enforced by S3
 * @param {number}             [expiresIn]   Seconds until expiry (default 900 = 15 min)
 */
async function getSignedUploadUrl(bucket, domain, id, filename, contentType, maxBytes, expiresIn = 900) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw Object.assign(new Error('A positive server-side upload size limit is required.'), { statusCode: 400 });
  }
  validateUpload(contentType, maxBytes);

  const client     = getClient();
  const bucketName = resolveBucket(bucket);
  const key        = buildKey(domain, id, filename);

  const post = await createPresignedPost(client, {
    Bucket: bucketName,
    Key: key,
    Fields: { 'Content-Type': contentType },
    Conditions: [
      ['eq', '$Content-Type', contentType],
      ['content-length-range', 1, maxBytes],
    ],
    Expires: expiresIn,
  });

  return { key, uploadUrl: post.url, fields: post.fields };
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * Delete an object from S3.
 *
 * @param {string}             key
 * @param {'public'|'private'} bucket
 */
async function deleteFile(key, bucket) {
  const client     = getClient();
  const bucketName = resolveBucket(bucket);
  await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
}

// ─── Head / exists check ─────────────────────────────────────────────────────

/**
 * Check whether an object exists in S3 without downloading it.
 * Returns { exists: boolean, contentLength: number|null, contentType: string|null }.
 */
async function headFile(key, bucket) {
  try {
    const client     = getClient();
    const bucketName = resolveBucket(bucket);
    const res = await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
    return {
      exists: true,
      contentLength: res.ContentLength ?? null,
      contentType: res.ContentType ?? null,
    };
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound') {
      return { exists: false, contentLength: null, contentType: null };
    }
    throw err;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  uploadPublic,
  uploadPrivate,
  upload,
  getSignedDownloadUrl,
  getSignedUploadUrl,
  deleteFile,
  headFile,
  // expose for testing
  validateUpload,
  buildKey,
  sanitiseFilename,
  ALLOWED_TYPES,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_DOC_TYPES,
  MAX_IMAGE_BYTES,
  MAX_DOC_BYTES,
};
