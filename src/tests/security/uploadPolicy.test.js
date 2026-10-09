'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.S3_BUCKET_PRIVATE = 'private-test-bucket';

const s3 = require('../../services/s3');

test('private uploads receive a POST policy with MIME and server size constraints', async () => {
  const maxBytes = 10 * 1024 * 1024;
  const upload = await s3.getSignedUploadUrl(
    'private',
    'test',
    'record-id',
    'drawing.pdf',
    'application/pdf',
    maxBytes
  );
  const policy = JSON.parse(Buffer.from(upload.fields.Policy, 'base64').toString('utf8'));

  assert.equal(upload.fields.key, upload.key);
  assert.equal(upload.fields['Content-Type'], 'application/pdf');
  assert.ok(policy.conditions.some((condition) => (
    Array.isArray(condition)
    && condition[0] === 'content-length-range'
    && condition[1] === 1
    && condition[2] === maxBytes
  )));
  assert.ok(policy.conditions.some((condition) => (
    Array.isArray(condition)
    && condition[0] === 'eq'
    && condition[1] === '$Content-Type'
    && condition[2] === 'application/pdf'
  )));
});

test('private upload signing refuses an unsafe maximum size', async () => {
  await assert.rejects(
    s3.getSignedUploadUrl('private', 'test', 'record-id', 'large.pdf', 'application/pdf', s3.MAX_DOC_BYTES + 1),
    /File exceeds the 100 MB size limit/
  );
});
