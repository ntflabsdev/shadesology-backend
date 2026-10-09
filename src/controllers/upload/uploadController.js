'use strict';

/**
 * Upload Controller — presigned S3 upload URLs for client-side direct uploads.
 *
 * Flow for quote attachments (drawings, photos):
 *   1. Frontend calls POST /api/quotes/upload-url with { filename, contentType, quoteId? }
 *   2. This endpoint returns a policy-bound POST URL and required fields
 *   3. Frontend submits a multipart form directly to S3
 *   4. On success, frontend includes { s3Key: key } in the quote submission body
 *
 * This pattern keeps large files off the API server. The API server only issues
 * the presigned URL and later records the key — it never touches the file bytes.
 *
 * Files always go to the PRIVATE bucket (never public). They are served only
 * via signed download URLs after an access check.
 */

const s3 = require('../../services/s3');
const { createError } = require('../../middlewares/errorHandler');

// Allowed MIME types for quote attachments
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  // AutoCAD / DXF / DWG
  'application/acad',
  'image/vnd.dwg',
  'application/octet-stream',
]);

const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB per file for drawings

/**
 * POST /api/quotes/upload-url
 *
 * Body: { filename, contentType, sizeBytes?, quoteId? }
 * Returns: { key, uploadUrl, fields, expiresInSeconds }
 */
const getPresignedUploadUrl = async (req, res, next) => {
  try {
    const { filename, contentType, sizeBytes, quoteId } = req.body;

    if (!filename || !contentType) {
      return next(createError(400, 'filename and contentType are required.'));
    }

    // Sanitise content type — strip parameters like "; charset=utf-8"
    const mimeType = contentType.split(';')[0].trim().toLowerCase();

    if (!ALLOWED_TYPES.has(mimeType)) {
      return next(createError(400, `File type "${mimeType}" is not allowed. Allowed: images (JPEG, PNG, WebP, HEIC), PDF, CAD files.`));
    }

    const parsedSize = Number(sizeBytes);
    if (!Number.isSafeInteger(parsedSize) || parsedSize < 1) {
      return next(createError(400, 'sizeBytes must be a positive integer.'));
    }
    if (parsedSize > MAX_SIZE_BYTES) {
      const mb = Math.round(MAX_SIZE_BYTES / 1024 / 1024);
      return next(createError(400, `File exceeds the ${mb} MB size limit.`));
    }
    const maxBytes = mimeType.startsWith('image/')
      ? Math.min(MAX_SIZE_BYTES, s3.MAX_IMAGE_BYTES)
      : Math.min(MAX_SIZE_BYTES, s3.MAX_DOC_BYTES);
    if (parsedSize > maxBytes) {
      return next(createError(400, `File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB size limit for this file type.`));
    }

    // Use quoteId as the record ID (or 'pending' for pre-submission uploads)
    const recordId = quoteId || 'pending';
    const EXPIRY   = 900; // 15 minutes — enough time to upload then submit the form

    const { key, uploadUrl, fields } = await s3.getSignedUploadUrl(
      'private',
      'quotes',
      recordId,
      filename,
      mimeType,
      maxBytes,
      EXPIRY
    );

    res.json({
      success: true,
      key,
      uploadUrl,
      fields,
      expiresInSeconds: EXPIRY,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getPresignedUploadUrl, MAX_SIZE_BYTES };
