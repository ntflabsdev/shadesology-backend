'use strict';

/**
 * Download controller — gated document delivery.
 *
 * Rules:
 *   open           → direct redirect to fileUrl (or signed S3 URL)
 *   email_required → capture email as lead, then deliver
 *   logged_in      → authenticate middleware must pass
 *   role_required  → authenticate + role check
 *
 * Every download is tracked (count + optional lead capture stored in DB FIRST
 * before any outbound call per spec rule 10).
 */

const Document  = require('../../models/Document');
const Installer = require('../../models/Installer');
const Company = require('../../models/Company');
const DocumentAccess = require('../../models/DocumentAccess');
const AuditLog = require('../../models/AuditLog');
const Lead = require('../../models/Lead');
const hubspot = require('../../services/hubspot');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const { createError } = require('../../middlewares/errorHandler');
const { getQueue }    = require('../../queues/index');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function enqueueEmail(opts) {
  try {
    getQueue('email').add('send', opts, { attempts: 5 }).catch((err) =>
      console.error('[DownloadCtrl] email queue:', err.message)
    );
  } catch {
    console.warn('[DownloadCtrl] email queue unavailable');
  }
}

/** Increment download count — fire-and-forget */
function trackDownload(docId) {
  Document.findByIdAndUpdate(docId, { $inc: { downloadCount: 1 } }).exec().catch(() => {});
}

/** Check whether a document is accessible by the current user/request */
function checkGating(doc, user, guestEmail) {
  switch (doc.gating) {
    case 'open':
      return { allowed: true };

    case 'email_required':
      if (user || guestEmail) return { allowed: true };
      return { allowed: false, reason: 'email_required', message: 'Please provide your email to download this document.' };

    case 'logged_in':
      if (user) return { allowed: true };
      return { allowed: false, reason: 'login_required', message: 'Please sign in to download this document.' };

    case 'role_required':
      if (!user) return { allowed: false, reason: 'login_required', message: 'Please sign in to access this document.' };
      if (doc.requiredRole && user.role !== doc.requiredRole && user.role !== 'staff') {
        return { allowed: false, reason: 'role_required', message: `A ${doc.requiredRole} account is required to access this document.` };
      }
      return { allowed: true };

    default:
      return {
        allowed: false,
        reason: 'unavailable',
        message: 'This document is not currently available.',
      };
  }
}

async function checkInstallerCertification(doc, user) {
  const installerOnly = doc.audienceTags?.includes('installer') || doc.requiredRole === 'installer';
  if (!installerOnly) {return true;}
  if (!user || user.role !== 'installer' || !doc.productTypes?.length) {return false;}
  const installer = await Installer.findOne({
    user: user._id,
    isActive: true,
    status: 'approved',
    certifiedProductTypes: { $in: doc.productTypes },
    $or: [{ insuranceExpiry: null }, { insuranceExpiry: { $gt: new Date() } }],
  }).select('_id').lean();
  return Boolean(installer);
}

async function checkProfessionalAudience(doc, user) {
  const requiredRoles = ['dealer', 'specifier'].filter((role) =>
    doc.audienceTags?.includes(role) || doc.requiredRole === role);
  if (!requiredRoles.length) {return true;}
  if (user?.role === 'staff') {return true;}
  if (!user?.isEmailVerified || !user.company || !requiredRoles.includes(user.role)) {return false;}
  if (doc.requiredRole && doc.requiredRole !== user.role) {return false;}
  const company = await Company.findOne({
    _id: user.company,
    type: user.role,
    isActive: true,
    isApproved: true,
  }).select('_id').lean();
  return Boolean(company);
}

// ─── GET /api/downloads/:id — serve a document ────────────────────────────────
const serveDocument = async (req, res, next) => {
  try {
    const doc = await Document.findById(req.params.id).lean();
    if (!doc || !doc.isActive) return next(createError(404, 'Document not found.'));

    // Check expiry
    if (doc.expiryDate && new Date() > new Date(doc.expiryDate)) {
      return next(createError(410, 'This document has expired and is no longer available.'));
    }
    if (doc.effectiveDate && new Date(doc.effectiveDate) > new Date()) {
      return next(createError(404, 'This document is not yet available.'));
    }

    const guestEmail = req.body?.email || req.query?.email || null;
    if (doc.gating === 'email_required' && guestEmail &&
      (typeof guestEmail !== 'string' || guestEmail.length > 254 || !EMAIL_RE.test(guestEmail.trim()))) {
      return next(createError(400, 'A valid email address is required.'));
    }
    const { allowed, reason, message } = checkGating(doc, req.user || null, guestEmail);

    if (!allowed) {
      return res.status(403).json({
        success: false,
        gatingReason: reason,
        message,
        document: {
          _id: doc._id,
          title: doc.title,
          type: doc.type,
          gating: doc.gating,
        },
      });
    }

    if (!await checkProfessionalAudience(doc, req.user || null)) {
      return next(createError(403, 'An approved professional company account is required to access this document.'));
    }
    if (req.user && ['dealer', 'specifier'].some((role) =>
      doc.audienceTags?.includes(role) || doc.requiredRole === role)) {
      await DocumentAccess.create({
        document: doc._id,
        user: req.user._id,
        company: req.user.company,
        ip: req.ip,
        userAgent: req.get('user-agent') || '',
      });
      await AuditLog.record({
        event: 'document_accessed',
        actor: req.user._id,
        actorEmail: req.user.email,
        meta: {
          documentId: String(doc._id),
          documentTitle: doc.title?.en || '',
          role: req.user.role,
          companyId: String(req.user.company),
        },
        ip: req.ip,
        userAgent: req.get('user-agent') || '',
      });
    }

    if (!await checkInstallerCertification(doc, req.user || null)) {
      return next(createError(403, 'You must be an approved installer certified for a product associated with this technical document.'));
    }

    // Track download (fire-and-forget)
    trackDownload(doc._id);

    if (doc.gating === 'email_required' && guestEmail) {
      const email = guestEmail.trim().toLowerCase();
      const source = `download:${doc._id}`;
      const lead = await Lead.findOneAndUpdate(
        { email, source },
        {
          $setOnInsert: {
            enquiryType: 'contact',
            name: email.split('@')[0],
            email,
            subject: `Document download: ${doc.title?.en ?? 'Document'}`,
            message: `Requested the gated document "${doc.title?.en ?? 'Document'}" (${doc._id}).`,
            productType: String(doc.type || ''),
            source,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      await hubspot.enqueueSync('lead', lead._id.toString());
    }

    // Return the file URL (for private S3 files, generate a signed URL)
    let downloadUrl = doc.fileUrl;

    // If file is stored in S3 private bucket (URL does not start with http)
    // generate a signed URL. We detect private files by checking for S3 key format.
    if (doc.fileUrl && !doc.fileUrl.startsWith('http') && process.env.S3_BUCKET_PRIVATE) {
      try {
        const s3 = require('../../services/s3');
        downloadUrl = await s3.getSignedDownloadUrl(doc.fileUrl, 'private', 3600);
      } catch (err) {
        console.error('[DownloadCtrl] signed URL error:', err.message);
        return next(createError(500, 'Unable to generate download link. Please try again.'));
      }
    }

    res.json({
      success: true,
      data: {
        _id: doc._id,
        title: doc.title,
        type: doc.type,
        currentVersion: doc.currentVersion,
        mimeType: doc.mimeType,
        fileSizeBytes: doc.fileSizeBytes,
        downloadUrl,
        expiresIn: doc.fileUrl && !doc.fileUrl.startsWith('http') ? 3600 : null,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/downloads/:id/request — capture email for gated doc ────────────
const requestDocument = async (req, res, next) => {
  try {
    const { email, firstName, lastName } = req.body;
    if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email.trim())) {
      return next(createError(400, 'A valid email address is required.'));
    }
    const normalizedEmail = email.trim().toLowerCase();

    const doc = await Document.findById(req.params.id).lean();
    if (!doc || !doc.isActive) return next(createError(404, 'Document not found.'));

    if (doc.expiryDate && new Date() > new Date(doc.expiryDate)) {
      return next(createError(410, 'This document has expired.'));
    }
    if (!await checkInstallerCertification(doc, req.user || null)) {
      return next(createError(403, 'This technical document is available only to installers certified for an associated product.'));
    }

    // Track
    trackDownload(doc._id);

    const lead = await Lead.create({
      enquiryType: 'contact',
      name: [firstName, lastName].filter(Boolean).join(' ').trim() || normalizedEmail.split('@')[0],
      email: normalizedEmail,
      subject: `Document download: ${doc.title?.en ?? 'Document'}`,
      message: `Requested the gated document "${doc.title?.en ?? 'Document'}" (${doc._id}).`,
      productType: String(doc.type || ''),
      source: 'download_request',
    });

    // Store the lead before making outbound email or CRM calls.
    await hubspot.enqueueSync('lead', lead._id.toString());

    // Send the download link via email
    const frontendUrl = process.env.FRONTEND_URL || 'https://shadesology.com';
    enqueueEmail({
      to:      normalizedEmail,
      subject: `Your download: ${doc.title?.en ?? 'Document'}`,
      html: `
        <h2 style="color:#1B4332">Your requested document is ready</h2>
        <p>Hi ${firstName || 'there'},</p>
        <p>Thank you for your interest. Here is your download link for <strong>${doc.title?.en ?? 'the requested document'}</strong>:</p>
        <p><a href="${frontendUrl}/downloads/${doc._id}?email=${encodeURIComponent(normalizedEmail)}" style="background:#1B4332;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">Download Now</a></p>
        <p style="color:#6B7280;font-size:13px">This link will take you directly to the file. If you have any questions, reply to this email.</p>
      `,
      text: `Download ${doc.title?.en}: ${frontendUrl}/downloads/${doc._id}?email=${encodeURIComponent(normalizedEmail)}`,
    });

    res.json({
      success: true,
      message: 'Download link sent to your email.',
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/downloads — list available documents ────────────────────────────
const listDocuments = async (req, res, next) => {
  try {
    const { type, productId, productTypeId, audience } = req.query;
    const now = new Date();

    const filter = {
      isActive: true,
      showInResourceLibrary: true,
      $and: [{ $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }] }],
    };

    if (type)          filter.type = type;
    if (productId)     filter.products = productId;
    if (productTypeId) filter.productTypes = productTypeId;
    if (req.user?.role === 'installer') {
      const installer = await Installer.findOne({
        user: req.user._id,
        isActive: true,
        status: 'approved',
        $or: [{ insuranceExpiry: null }, { insuranceExpiry: { $gt: now } }],
      }).select('certifiedProductTypes').lean();
      filter.productTypes = { $in: installer?.certifiedProductTypes || [] };
      filter.$and.push({ $or: [{ audienceTags: 'installer' }, { requiredRole: 'installer' }] });
    } else {
      filter.audienceTags = { $nin: ['installer', 'dealer', 'specifier'] };
      filter.requiredRole = { $nin: ['dealer', 'specifier'] };
    }
    if (audience && req.user?.role === 'installer' && audience !== 'installer') {
      filter.audienceTags = audience;
    }

    const docs = await Document.find(filter)
      .sort({ type: 1, 'title.en': 1 })
      .select('title type currentVersion effectiveDate expiryDate gating mimeType fileSizeBytes downloadCount audienceTags')
      .lean();

    res.json({ success: true, data: docs });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  serveDocument,
  requestDocument,
  listDocuments,
  checkInstallerCertification,
  checkProfessionalAudience,
};
