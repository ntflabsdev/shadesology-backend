'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { authenticate } = require('../middlewares/authenticate');
const { requireRole } = require('../middlewares/requireRole');
const { createError } = require('../middlewares/errorHandler');
const rateLimit = require('../middlewares/rateLimit');
const { generateToken, hashToken } = require('../utils/crypto');
const { getQueue } = require('../queues');
const User = require('../models/User');
const Company = require('../models/Company');
const Product = require('../models/Product');
const Variant = require('../models/Variant');
const CompanyInvitation = require('../models/CompanyInvitation');
const CompanyProjectFolder = require('../models/CompanyProjectFolder');
const DealerWarrantyClaim = require('../models/DealerWarrantyClaim');
const DealerTrainingProgress = require('../models/DealerTrainingProgress');
const Document = require('../models/Document');
const DocumentAccess = require('../models/DocumentAccess');
const ApprovalRequest = require('../models/ApprovalRequest');
const AuditLog = require('../models/AuditLog');
const Lead = require('../models/Lead');
const Order = require('../models/Order');
const Quote = require('../models/Quote');
const s3 = require('../services/s3');
const hubspot = require('../services/hubspot');
const { normalizeOrderForResponse } = require('../services/orderFormatting');
const { resolvePricingUser } = require('../services/commercialPricing');
const { publishedReadFilter } = require('../services/payloadPublicContent');
const pricing = require('@shadesology/pricing');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COMPANY_TYPES = new Map([['dealer', 'dealer'], ['specifier', 'specifier']]);
const PRIVATE_DOC_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const CLAIM_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
const COMMERCIAL_DOCS = new Set(['cad', 'bim', 'spec_sheet', 'certificate', 'engineering_report', 'other', 'manual']);

function clean(value, max = 500) {
  return typeof value === 'string' ? value.replace(/\p{Cc}/gu, ' ').trim().slice(0, max) : '';
}

function validId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

async function activeCompany(req, expectedType) {
  const user = await User.findById(req.user._id).select('role company isActive isCompanyAdmin email isEmailVerified pricingGroup');
  if (!user || !user.isActive || !user.isEmailVerified || user.role !== expectedType) {
    throw createError(403, `An approved ${expectedType} account is required.`);
  }
  if (!user.company) {throw createError(403, 'Your account is not linked to an approved company.');}
  const company = await Company.findOne({
    _id: user.company,
    type: expectedType,
    isActive: true,
    isApproved: true,
  });
  if (!company) {throw createError(403, 'Your company account is not approved or is inactive.');}
  return { user, company };
}

async function activeCompanyAdmin(req) {
  if (!req.user.company || !['dealer', 'specifier'].includes(req.user.role)) {
    throw createError(403, 'An approved company administrator is required.');
  }
  const { user, company } = await activeCompany(req, req.user.role);
  if (!user.isCompanyAdmin || String(company.companyAdmin) !== String(user._id)) {
    throw createError(403, 'Only the current company administrator may manage team members.');
  }
  return { user, company };
}

function activeWindow(now) {
  return {
    isActive: true,
    $and: [
      { $or: [{ effectiveDate: null }, { effectiveDate: { $lte: now } }] },
      { $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }] },
    ],
  };
}

function documentAudience(role) {
  return {
    $or: [
      { audienceTags: role },
      { requiredRole: role },
      { gating: 'role_required', requiredRole: role },
    ],
  };
}

async function getRoleDocuments(role, query = {}) {
  const now = new Date();
  const filter = { ...activeWindow(now), ...documentAudience(role) };
  if (query.type) {
    if (!COMMERCIAL_DOCS.has(query.type)) {throw createError(400, 'Unsupported technical document type.');}
    filter.type = query.type;
  }
  if (query.productType) {
    if (!validId(query.productType)) {throw createError(400, 'productType must be a valid product type ID.');}
    filter.productTypes = query.productType;
  }
  const docs = await Document.find(filter)
    .select('title description type currentVersion effectiveDate expiryDate gating requiredRole audienceTags products productTypes manufacturers fileSizeBytes mimeType')
    .populate('productTypes', 'name slug code')
    .populate('products', 'name slug')
    .sort({ type: 1, 'title.en': 1 })
    .limit(200)
    .lean();
  const search = clean(query.q, 100).toLowerCase();
  return docs.filter((doc) => !search || [
    doc.title?.en,
    doc.description?.en,
    doc.type,
    ...(doc.productTypes || []).map((item) => item.name?.en || item.slug),
    ...(doc.products || []).map((item) => item.name?.en || item.slug),
  ].join(' ').toLowerCase().includes(search));
}

async function privateDocumentLink(doc, req, company, role) {
  if (
    !doc ||
    (doc.requiredRole && doc.requiredRole !== role) ||
    !doc.isActive ||
    (doc.expiryDate && new Date(doc.expiryDate) <= new Date()) ||
    (doc.effectiveDate && new Date(doc.effectiveDate) > new Date()) ||
    (!(doc.audienceTags || []).includes(role) && doc.requiredRole !== role)
  ) {
    throw createError(404, 'Technical document not found.');
  }
  if (!doc.fileUrl || /^https?:\/\//i.test(doc.fileUrl)) {
    throw createError(409, 'Technical documents must be stored in private S3 storage.');
  }
  const downloadUrl = await s3.getSignedDownloadUrl(doc.fileUrl, 'private', 300);
  await Promise.all([
    DocumentAccess.create({
      document: doc._id,
      user: req.user._id,
      company: company._id,
      ip: req.ip,
      userAgent: clean(req.get('user-agent'), 500),
    }),
    AuditLog.record({
      event: 'document_accessed',
      actor: req.user._id,
      actorEmail: req.user.email,
      meta: { documentId: String(doc._id), documentTitle: doc.title?.en || '', role, companyId: String(company._id) },
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
    }),
  ]);
  await Document.updateOne({ _id: doc._id }, { $inc: { downloadCount: 1 } });
  return {
    _id: String(doc._id),
    title: doc.title,
    type: doc.type,
    currentVersion: doc.currentVersion,
    downloadUrl,
    expiresIn: 300,
  };
}

async function createApplication(req, res, next) {
  try {
    const { type, data = {}, documents = [] } = req.body || {};
    const companyType = COMPANY_TYPES.get(type);
    if (!companyType) {return next(createError(400, 'Application type must be dealer or specifier.'));}
    if (!req.user.isEmailVerified) {return next(createError(403, 'Verify your email before applying for a professional account.'));}
    if (req.user.role !== 'customer' || req.user.company) {
      return next(createError(409, 'Your account already has a professional role or company membership.'));
    }
    const businessName = clean(data.businessName || data.firmName, 200);
    const businessEmail = clean(data.businessEmail || req.user.email, 254).toLowerCase();
    const phone = clean(data.phone || req.user.phone, 40);
    const website = clean(data.website, 300);
    const city = clean(data.city, 120);
    const state = clean(data.state, 80);
    const industry = clean(data.industry || data.businessType, 120);
    if (businessName.length < 2 || !EMAIL_RE.test(businessEmail) || !city || !state) {
      return next(createError(400, 'Business name, valid business email, city, and state are required.'));
    }
    if (website) {
      try {
        if (new URL(website).protocol !== 'https:') {throw new Error('invalid');}
      } catch {
        return next(createError(400, 'website must be a valid HTTPS URL.'));
      }
    }
    if (!Array.isArray(documents) || documents.length > 5) {
      return next(createError(400, 'A maximum of five verification documents may be attached.'));
    }
    const existing = await ApprovalRequest.findOne({
      applicant: req.user._id,
      type: `${companyType}_application`,
      status: { $in: ['pending', 'in_review'] },
    }).lean();
    if (existing) {
      return next(createError(409, `You already have a pending application (ref: ${existing.referenceNumber}).`));
    }
    const verifiedDocuments = await Promise.all(documents.map(async (item) => {
      const key = typeof item?.key === 'string' ? item.key : '';
      const prefix = `${process.env.NODE_ENV || 'development'}/professional-applications/${req.user._id}/`;
      if (!key.startsWith(prefix)) {throw createError(400, 'One or more verification files are invalid.');}
      const file = await s3.headFile(key, 'private');
      if (!file.exists || !PRIVATE_DOC_TYPES.has(file.contentType) ||
        !Number.isSafeInteger(file.contentLength) || file.contentLength < 1 || file.contentLength > s3.MAX_DOC_BYTES) {
        throw createError(400, 'A verification file has an unsupported type or size.');
      }
      return {
        label: clean(item.label, 100) || 'Professional verification',
        fileUrl: key,
        contentType: file.contentType,
        sizeBytes: file.contentLength,
      };
    }));

    const company = await Company.create({
      name: businessName,
      tradingName: clean(data.tradingName, 200),
      abn: clean(data.taxId || data.abn || data.membershipNumber, 100),
      website,
      industry,
      phone,
      email: businessEmail,
      address: { line1: clean(data.address, 200), city, state, zip: clean(data.zip, 20), country: 'US' },
      companyAdmin: req.user._id,
      type: companyType,
      isApproved: false,
      isActive: true,
    });
    req.user.company = company._id;
    req.user.isCompanyAdmin = true;
    await req.user.save({ validateBeforeSave: false });

    const requestData = {
      businessName,
      businessEmail,
      website,
      city,
      state,
      industry,
      professionalBody: clean(data.professionalBody, 200),
      membershipNumber: clean(data.membershipNumber, 150),
      productsOfInterest: clean(data.productsOfInterest, 1000),
      annualVolume: clean(data.annualVolume, 100),
      currentBrands: clean(data.currentBrands, 1000),
      projectTypes: Array.isArray(data.projectTypes)
        ? data.projectTypes.slice(0, 20).map((value) => clean(value, 100)).filter(Boolean)
        : [],
    };
    const request = await ApprovalRequest.create({
      type: `${companyType}_application`,
      applicant: req.user._id,
      company: company._id,
      data: requestData,
      documents: verifiedDocuments,
    });
    await hubspot.enqueueSync('application', request._id.toString());
    const recipient = process.env.LEADS_NOTIFY_EMAIL || process.env.SES_REPLY_TO || process.env.SES_FROM_EMAIL;
    if (recipient) {
      try {
        await getQueue('email').add('send', {
          to: recipient,
          subject: `${companyType} application received (${request.referenceNumber})`,
          text: `${businessName} submitted a ${companyType} application. Applicant: ${req.user.email}\nReference: ${request.referenceNumber}`,
        }, { jobId: `professional-application-${request._id}` });
      } catch (error) {
        console.error('[Portals] Application notification enqueue failed; application remains stored:', error.message);
      }
    } else {
      console.error('[Portals] No application notification recipient configured; application remains stored:', String(request._id));
    }
    try {
      await getQueue('email').add('send', {
        to: req.user.email,
        subject: 'Professional application received',
        text: `Your ${companyType} application has been received and is awaiting review.\nReference: ${request.referenceNumber}`,
      }, { jobId: `professional-application-applicant-${request._id}` });
    } catch (error) {
      console.error('[Portals] Applicant confirmation could not be queued; application remains stored:', error.message);
    }
    res.status(201).json({
      success: true,
      data: { _id: request._id, referenceNumber: request.referenceNumber, status: request.status },
      message: 'Application submitted for professional verification.',
    });
  } catch (error) {
    next(error);
  }
}

async function applicationUploadUrl(req, res, next) {
  try {
    const { filename, contentType, sizeBytes } = req.body || {};
    if (!req.user.isEmailVerified || req.user.role !== 'customer' || req.user.company) {
      return next(createError(403, 'A verified customer account without an existing company is required.'));
    }
    if (typeof filename !== 'string' || !PRIVATE_DOC_TYPES.has(contentType) ||
      !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > s3.MAX_DOC_BYTES) {
      return next(createError(400, 'Verification files must be PDF, JPEG, PNG or WebP and within the file-size limit.'));
    }
    const upload = await s3.getSignedUploadUrl(
      'private',
      'professional-applications',
      String(req.user._id),
      filename,
      contentType,
      s3.MAX_DOC_BYTES,
      900,
    );
    res.json({ success: true, data: upload });
  } catch (error) {
    next(error);
  }
}

router.use(authenticate);
router.post('/applications', rateLimit({ windowMs: 60_000, max: 3, keyPrefix: 'rl:professional-application' }), createApplication);
router.post('/applications/upload-url', rateLimit({ windowMs: 60_000, max: 5, keyPrefix: 'rl:professional-application-upload' }), applicationUploadUrl);
router.get('/applications/mine', async (req, res, next) => {
  try {
    const requests = await ApprovalRequest.find({
      applicant: req.user._id,
      type: { $in: ['dealer_application', 'specifier_application'] },
    }).sort({ createdAt: -1 })
      .select('-documents.fileUrl -documents.contentType -documents.sizeBytes -data -resolution')
      .lean();
    res.json({ success: true, data: requests });
  } catch (error) {
    next(error);
  }
});

router.get('/company', async (req, res, next) => {
  try {
    if (!req.user.company) {return next(createError(404, 'No company membership is linked to this account.'));}
    const company = await Company.findOne({ _id: req.user.company, isActive: true })
      .select('name tradingName type isApproved pricingGroup paymentTerms creditLimit companyAdmin')
      .lean();
    if (!company) {return next(createError(404, 'Company not found.'));}
    res.json({ success: true, data: { ...company, canManageMembers: String(company.companyAdmin) === String(req.user._id) } });
  } catch (error) {
    next(error);
  }
});

router.get('/company/members', async (req, res, next) => {
  try {
    await activeCompanyAdmin(req);
    const members = await User.find({ company: req.user.company })
      .select('firstName lastName email role isActive isCompanyAdmin lastLoginAt createdAt')
      .sort({ createdAt: 1 }).lean();
    res.json({ success: true, data: members });
  } catch (error) {
    next(error);
  }
});

router.post('/company/invitations', async (req, res, next) => {
  try {
    if (!req.user.isEmailVerified) {
      return next(createError(403, 'A verified company administrator is required.'));
    }
    const { company } = await activeCompanyAdmin(req);
    const email = clean(req.body?.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email) || email === req.user.email) {return next(createError(400, 'Enter a valid team member email address.'));}
    if (!COMPANY_TYPES.has(company.type)) {return next(createError(403, 'Only active approved dealer or specifier companies can invite members.'));}
    const existingUser = await User.findOne({ email }).select('company').lean();
    if (existingUser?.company) {return next(createError(409, 'This user already belongs to a company.'));}
    const token = generateToken();
    const invitation = await CompanyInvitation.findOneAndUpdate(
      { company: company._id, email, acceptedAt: null },
      {
        $set: {
          role: company.type,
          tokenHash: hashToken(token),
          invitedBy: req.user._id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
        $setOnInsert: { company: company._id, email },
      },
      { new: true, upsert: true, runValidators: true },
    );
    const inviteUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/company/invites/accept?token=${encodeURIComponent(token)}`;
    try {
      await getQueue('email').add('send', {
        to: email,
        subject: `Invitation to join ${company.name}`,
        text: `You have been invited to join ${company.name} as a ${company.type}. Sign in with this email and accept the invitation: ${inviteUrl}\nThis invitation expires in 7 days.`,
      }, { jobId: `company-invitation-${invitation._id}-${invitation.updatedAt.getTime()}` });
    } catch (error) {
      console.error('[Portals] Company invitation saved but email could not be queued:', error.message);
      return next(createError(503, 'Invitation is saved, but email delivery is unavailable. Retry sending the invitation.'));
    }
    await AuditLog.record({
      event: 'company_member_invited',
      actor: req.user._id,
      actorEmail: req.user.email,
      meta: { companyId: String(company._id), invitationId: String(invitation._id), invitedEmail: email },
      ip: req.ip,
    });
    res.status(201).json({ success: true, data: { _id: invitation._id, email, expiresAt: invitation.expiresAt } });
  } catch (error) {
    next(error);
  }
});

router.patch('/company/admin', async (req, res, next) => {
  try {
    if (!validId(req.body?.userId)) {
      return next(createError(403, 'A company administrator and a valid member ID are required.'));
    }
    const { company } = await activeCompanyAdmin(req);
    const nextAdmin = await User.findOne({
      _id: req.body.userId,
      company: company._id,
      role: company.type,
      isActive: true,
    }).select('+tokenVersion');
    if (!nextAdmin) {return next(createError(404, 'An active member of this company was not found.'));}
    if (String(nextAdmin._id) === String(req.user._id)) {return next(createError(400, 'This member is already the company administrator.'));}
    const currentAdmin = await User.findById(req.user._id).select('+tokenVersion');
    if (!currentAdmin) {return next(createError(404, 'Current company administrator was not found.'));}
    company.companyAdmin = nextAdmin._id;
    currentAdmin.isCompanyAdmin = false;
    currentAdmin.tokenVersion += 1;
    nextAdmin.isCompanyAdmin = true;
    nextAdmin.tokenVersion += 1;
    await Promise.all([company.save(), currentAdmin.save({ validateBeforeSave: false }), nextAdmin.save({ validateBeforeSave: false })]);
    await AuditLog.record({
      event: 'company_updated',
      actor: req.user._id,
      actorEmail: req.user.email,
      subject: nextAdmin._id,
      subjectEmail: nextAdmin.email,
      meta: { companyId: String(company._id), action: 'administrator_delegated' },
      ip: req.ip,
    });
    res.json({ success: true, data: { companyAdmin: String(nextAdmin._id) }, message: 'Company administrator changed. Both sessions were revoked.' });
  } catch (error) {
    next(error);
  }
});

router.post('/company/invitations/accept', async (req, res, next) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!token || !req.user.isEmailVerified) {return next(createError(400, 'A valid invitation and verified account are required.'));}
    const invitation = await CompanyInvitation.findOneAndUpdate({
      tokenHash: hashToken(token),
      email: req.user.email.toLowerCase(),
      acceptedAt: null,
      expiresAt: { $gt: new Date() },
    }, {
      $set: { acceptedAt: new Date(), acceptedBy: req.user._id },
    }, { new: true }).select('+tokenHash');
    if (!invitation) {return next(createError(404, 'Invitation is invalid, expired, or belongs to another email address.'));}
    const company = await Company.findOne({ _id: invitation.company, type: invitation.role, isApproved: true, isActive: true });
    if (!company || req.user.company) {
      await CompanyInvitation.updateOne(
        { _id: invitation._id, acceptedBy: req.user._id },
        { $set: { acceptedAt: null, acceptedBy: null } },
      );
      return next(createError(409, 'Company is unavailable or your account already has a company membership.'));
    }
    const user = await User.findOne({ _id: req.user._id, email: invitation.email, company: null, role: 'customer' }).select('+tokenVersion');
    if (!user) {
      await CompanyInvitation.updateOne(
        { _id: invitation._id, acceptedBy: req.user._id },
        { $set: { acceptedAt: null, acceptedBy: null } },
      );
      return next(createError(409, 'This account cannot accept the invitation.'));
    }
    const membership = await User.updateOne(
      { _id: user._id, company: null, role: 'customer', tokenVersion: user.tokenVersion },
      { $set: { company: company._id, role: invitation.role, isCompanyAdmin: false }, $inc: { tokenVersion: 1 } },
    );
    if (membership.modifiedCount !== 1) {
      await CompanyInvitation.updateOne(
        { _id: invitation._id, acceptedBy: user._id },
        { $set: { acceptedAt: null, acceptedBy: null } },
      );
      return next(createError(409, 'This account cannot accept the invitation.'));
    }
    await AuditLog.record({
      event: 'company_member_joined',
      actor: user._id,
      actorEmail: user.email,
      meta: { companyId: String(company._id), invitationId: String(invitation._id) },
      ip: req.ip,
    });
    res.json({ success: true, data: { companyId: company._id, role: invitation.role }, message: 'Company invitation accepted. Sign in again to refresh your session.' });
  } catch (error) {
    next(error);
  }
});

router.get('/company/invitations', async (req, res, next) => {
  try {
    const { company } = await activeCompanyAdmin(req);
    const invitations = await CompanyInvitation.find({ company: company._id, acceptedAt: null, expiresAt: { $gt: new Date() } })
      .select('email role expiresAt createdAt')
      .sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: invitations });
  } catch (error) {
    next(error);
  }
});

router.use('/specifier', requireRole('specifier'));
router.get('/specifier/documents', async (req, res, next) => {
  try {
    const { user, company } = await activeCompany(req, 'specifier');
    const docs = await getRoleDocuments('specifier', req.query);
    res.json({
      success: true,
      data: docs.map((doc) => ({
        _id: String(doc._id),
        title: doc.title,
        description: doc.description,
        type: doc.type,
        currentVersion: doc.currentVersion,
        effectiveDate: doc.effectiveDate,
        expiryDate: doc.expiryDate,
        fileSizeBytes: doc.fileSizeBytes,
        mimeType: doc.mimeType,
        products: doc.products,
        productTypes: doc.productTypes,
        downloadUrl: `/api/portals/specifier/documents/${doc._id}/download`,
      })),
      meta: { companyId: String(company._id), role: user.role },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/specifier/documents/:id/download', async (req, res, next) => {
  try {
    const { company } = await activeCompany(req, 'specifier');
    if (!validId(req.params.id)) {return next(createError(400, 'Invalid document ID.'));}
    const doc = await Document.findOne({ _id: req.params.id, ...documentAudience('specifier') });
    res.json({ success: true, data: await privateDocumentLink(doc, req, company, 'specifier') });
  } catch (error) {
    next(error);
  }
});

router.post('/specifier/documents/bulk-links', async (req, res, next) => {
  try {
    const { company } = await activeCompany(req, 'specifier');
    const ids = req.body?.documentIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20 || ids.some((id) => !validId(id)) || new Set(ids).size !== ids.length) {
      return next(createError(400, 'Provide between 1 and 20 unique document IDs.'));
    }
    const docs = await Document.find({ _id: { $in: ids }, ...documentAudience('specifier') });
    if (docs.length !== ids.length) {return next(createError(403, 'One or more selected documents are unavailable to your account.'));}
    const links = await Promise.all(docs.map((doc) => privateDocumentLink(doc, req, company, 'specifier')));
    res.json({ success: true, data: links });
  } catch (error) {
    next(error);
  }
});

router.get('/specifier/downloads/mine', async (req, res, next) => {
  try {
    await activeCompany(req, 'specifier');
    const downloads = await DocumentAccess.find({ user: req.user._id })
      .populate('document', 'title type currentVersion')
      .select('document createdAt')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.json({ success: true, data: downloads });
  } catch (error) {
    next(error);
  }
});

router.get('/specifier/folders', async (req, res, next) => {
  try {
    const { company } = await activeCompany(req, 'specifier');
    const folders = await CompanyProjectFolder.find({ company: company._id })
      .populate('documents', 'title type currentVersion expiryDate')
      .sort({ updatedAt: -1 }).lean();
    res.json({ success: true, data: folders });
  } catch (error) {
    next(error);
  }
});

router.post('/specifier/folders', async (req, res, next) => {
  try {
    const { company } = await activeCompany(req, 'specifier');
    const name = clean(req.body?.name, 120);
    const description = clean(req.body?.description, 1000);
    if (name.length < 2) {return next(createError(400, 'Project folder name must contain at least 2 characters.'));}
    const ids = Array.isArray(req.body?.documents) ? req.body.documents : [];
    if (ids.length > 100 || ids.some((id) => !validId(id))) {return next(createError(400, 'Folder document list is invalid.'));}
    if (ids.length) {
      const count = await Document.countDocuments({ _id: { $in: ids }, ...documentAudience('specifier'), isActive: true });
      if (count !== new Set(ids).size) {return next(createError(403, 'A folder may include only active specifier documents.'));}
    }
    const folder = await CompanyProjectFolder.create({ company: company._id, createdBy: req.user._id, name, description, documents: [...new Set(ids)] });
    res.status(201).json({ success: true, data: folder });
  } catch (error) {
    next(error);
  }
});

router.patch('/specifier/folders/:id', async (req, res, next) => {
  try {
    const { company } = await activeCompany(req, 'specifier');
    if (!validId(req.params.id)) {return next(createError(400, 'Invalid project folder ID.'));}
    const updates = {};
    if (req.body?.name !== undefined) {
      updates.name = clean(req.body.name, 120);
      if (updates.name.length < 2) {return next(createError(400, 'Project folder name must contain at least 2 characters.'));}
    }
    if (req.body?.description !== undefined) {updates.description = clean(req.body.description, 1000);}
    if (req.body?.documents !== undefined) {
      if (!Array.isArray(req.body.documents) || req.body.documents.length > 100 || req.body.documents.some((id) => !validId(id))) {
        return next(createError(400, 'Folder document list is invalid.'));
      }
      const ids = [...new Set(req.body.documents)];
      const count = await Document.countDocuments({ _id: { $in: ids }, ...documentAudience('specifier'), isActive: true });
      if (count !== ids.length) {return next(createError(403, 'A folder may include only active specifier documents.'));}
      updates.documents = ids;
    }
    if (!Object.keys(updates).length) {return next(createError(400, 'Provide a folder name, description, or document list to update.'));}
    const folder = await CompanyProjectFolder.findOneAndUpdate(
      { _id: req.params.id, company: company._id },
      { $set: updates },
      { new: true, runValidators: true },
    );
    if (!folder) {return next(createError(404, 'Project folder not found.'));}
    res.json({ success: true, data: folder });
  } catch (error) {
    next(error);
  }
});

router.delete('/specifier/folders/:id', async (req, res, next) => {
  try {
    const { company } = await activeCompany(req, 'specifier');
    if (!validId(req.params.id)) {return next(createError(400, 'Invalid project folder ID.'));}
    const folder = await CompanyProjectFolder.findOneAndDelete({ _id: req.params.id, company: company._id });
    if (!folder) {return next(createError(404, 'Project folder not found.'));}
    res.json({ success: true, message: 'Project folder deleted.' });
  } catch (error) {
    next(error);
  }
});

router.post('/specifier/support', async (req, res, next) => {
  try {
    const { company } = await activeCompany(req, 'specifier');
    const message = clean(req.body?.message, 5000);
    const subject = clean(req.body?.subject, 200);
    if (subject.length < 3 || message.length < 10) {return next(createError(400, 'Subject and a detailed support message are required.'));}
    const lead = await Lead.create({
      enquiryType: 'commercial_project',
      leadQueue: 'commercial',
      commercialFlag: true,
      name: `${req.user.firstName} ${req.user.lastName}`.trim(),
      email: req.user.email,
      phone: req.user.phone || '',
      company: company.name,
      subject,
      issueType: 'specifier_technical_support',
      message,
      source: 'specifier_portal',
    });
    await hubspot.enqueueSync('lead', lead._id.toString());
    res.status(201).json({ success: true, data: { _id: lead._id }, message: 'Technical support request submitted.' });
  } catch (error) {
    next(error);
  }
});

router.use('/dealer', requireRole('dealer'));
router.get('/dealer/profile', async (req, res, next) => {
  try {
    const { user, company } = await activeCompany(req, 'dealer');
    const pendingOrders = await Order.aggregate([
      { $match: { company: company._id, paymentMethod: 'purchase_order', paymentStatus: { $in: ['pending', 'deposit_paid'] }, status: { $nin: ['cancelled', 'refunded'] } } },
      { $group: { _id: null, balance: { $sum: { $ifNull: ['$balanceDue', '$total'] } } } },
    ]);
    res.json({
      success: true,
      data: {
        user: { firstName: user.firstName, lastName: user.lastName, email: user.email, pricingGroup: user.pricingGroup || company.pricingGroup },
        company: {
          _id: company._id,
          name: company.name,
          pricingGroup: company.pricingGroup,
          creditLimit: company.creditLimit,
          paymentTerms: company.paymentTerms,
          outstandingBalance: pendingOrders[0]?.balance || 0,
          isCompanyAdmin: user.isCompanyAdmin,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/dealer/documents', async (req, res, next) => {
  try {
    const { company } = await activeCompany(req, 'dealer');
    const docs = await getRoleDocuments('dealer', req.query);
    res.json({
      success: true,
      data: docs.map((doc) => ({
        _id: String(doc._id),
        title: doc.title,
        description: doc.description,
        type: doc.type,
        currentVersion: doc.currentVersion,
        effectiveDate: doc.effectiveDate,
        expiryDate: doc.expiryDate,
        downloadUrl: `/api/portals/dealer/documents/${doc._id}/download`,
        ...(doc.type === 'manual' ? {
          progressUrl: `/api/portals/dealer/training/${doc._id}/progress`,
          progress: null,
        } : {}),
      })),
      meta: { companyId: String(company._id) },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/dealer/documents/:id/download', async (req, res, next) => {
  try {
    const { company } = await activeCompany(req, 'dealer');
    if (!validId(req.params.id)) {return next(createError(400, 'Invalid document ID.'));}
    const doc = await Document.findOne({ _id: req.params.id, ...documentAudience('dealer') });
    res.json({ success: true, data: await privateDocumentLink(doc, req, company, 'dealer') });
  } catch (error) {
    next(error);
  }
});

router.get('/dealer/training', async (req, res, next) => {
  try {
    const { company } = await activeCompany(req, 'dealer');
    const docs = await getRoleDocuments('dealer', { type: 'manual' });
    const progress = await DealerTrainingProgress.find({ user: req.user._id, company: company._id, document: { $in: docs.map((doc) => doc._id) } }).lean();
    const completed = new Map(progress.map((record) => [String(record.document), record.completedAt]));
    res.json({
      success: true,
      data: docs.map((doc) => ({
        _id: String(doc._id),
        title: doc.title,
        currentVersion: doc.currentVersion,
        expiryDate: doc.expiryDate,
        completedAt: completed.get(String(doc._id)) || null,
        downloadUrl: `/api/portals/dealer/documents/${doc._id}/download`,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.put('/dealer/training/:id/progress', async (req, res, next) => {
  try {
    const { company } = await activeCompany(req, 'dealer');
    if (!validId(req.params.id) || typeof req.body?.completed !== 'boolean') {
      return next(createError(400, 'A valid training document ID and completed boolean are required.'));
    }
    const doc = await Document.findOne({ _id: req.params.id, type: 'manual', ...documentAudience('dealer'), isActive: true }).select('_id');
    if (!doc) {return next(createError(404, 'Dealer training item not found.'));}
    const progress = await DealerTrainingProgress.findOneAndUpdate(
      { user: req.user._id, company: company._id, document: doc._id },
      { $set: { completedAt: req.body.completed ? new Date() : null } },
      { upsert: true, new: true, runValidators: true },
    );
    res.json({ success: true, data: progress });
  } catch (error) {
    next(error);
  }
});

router.get('/dealer/orders', async (req, res, next) => {
  try {
    const { company } = await activeCompany(req, 'dealer');
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const filter = { company: company._id };
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);
    res.json({ success: true, data: orders.map(normalizeOrderForResponse), pagination: { page, limit, total } });
  } catch (error) {
    next(error);
  }
});

router.get('/dealer/catalog', async (req, res, next) => {
  try {
    const { user } = await activeCompany(req, 'dealer');
    const search = clean(req.query.q, 100);
    const filter = publishedReadFilter({ isActive: true, showPrice: true });
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { 'name.en': { $regex: escaped, $options: 'i' } },
        { slug: { $regex: escaped, $options: 'i' } },
      ];
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const [products, total] = await Promise.all([
      Product.find(filter).select('name slug').sort({ 'name.en': 1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      Product.countDocuments(filter),
    ]);
    const variants = products.length
      ? await Variant.find(publishedReadFilter({
        product: { $in: products.map((product) => product._id) },
        isActive: true,
        availability: { $ne: 'discontinued' },
      })).select('product name sku basePrice priceTiers availability')
        .sort({ product: 1, sortOrder: 1 }).lean()
      : [];
    const productById = new Map(products.map((product) => [String(product._id), product]));
    const pricingUser = await resolvePricingUser(user);
    const data = variants.map((variant) => {
      const product = productById.get(String(variant.product));
      const price = pricing.resolvePriceForUser(variant.basePrice, variant.priceTiers || [], pricingUser);
      return {
        productId: String(variant.product),
        variantId: String(variant._id),
        productName: product?.name?.en || '',
        productSlug: product?.slug || '',
        variantName: variant.name?.en || variant.name || '',
        sku: variant.sku,
        unitCost: price.displayPrice,
        priceType: price.priceType,
      };
    });
    res.json({ success: true, data, pagination: { page, limit, total } });
  } catch (error) {
    next(error);
  }
});

router.post('/dealer/quotes', async (req, res, next) => {
  try {
    const { user, company } = await activeCompany(req, 'dealer');
    const markupPercent = req.body?.markupPercent;
    const items = req.body?.items;
    if (!Number.isFinite(markupPercent) || markupPercent < 0 || markupPercent > 1000) {
      return next(createError(400, 'markupPercent must be between 0 and 1000.'));
    }
    if (!Array.isArray(items) || items.length < 1 || items.length > 50 ||
        items.some((item) => !validId(item?.variantId) || !Number.isInteger(item?.quantity) || item.quantity < 1 || item.quantity > 1000) ||
        new Set(items.map((item) => item.variantId)).size !== items.length) {
      return next(createError(400, 'Provide 1 to 50 unique catalog variants with quantities from 1 to 1000.'));
    }
    const productFilter = publishedReadFilter({ isActive: true, showPrice: true });
    const normalizedItems = items.map((item) => ({ ...item, variantId: item.variantId.toLowerCase() }));
    const variants = await Variant.find(publishedReadFilter({
      _id: { $in: normalizedItems.map((item) => item.variantId) },
      isActive: true,
      availability: { $ne: 'discontinued' },
    })).select('product name sku basePrice priceTiers availability').lean();
    const products = await Product.find({
      ...productFilter,
      _id: { $in: variants.map((variant) => variant.product) },
    }).select('name').lean();
    if (variants.length !== normalizedItems.length || products.length !== new Set(variants.map((variant) => String(variant.product))).size) {
      return next(createError(422, 'One or more selected products are unavailable for dealer quoting.'));
    }
    const userWithPricing = await resolvePricingUser(user);
    const productById = new Map(products.map((product) => [String(product._id), product]));
    const variantById = new Map(variants.map((variant) => [String(variant._id), variant]));
    const quoteItems = normalizedItems.map((item) => {
      const variant = variantById.get(item.variantId);
      const product = productById.get(String(variant.product));
      const unitCost = pricing.resolvePriceForUser(
        variant.basePrice,
        variant.priceTiers || [],
        userWithPricing,
      ).displayPrice;
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        throw createError(409, 'A selected dealer price is unavailable. Refresh the catalog and try again.');
      }
      const resaleUnitPrice = Math.round(unitCost * (1 + markupPercent / 100) * 100) / 100;
      if (!Number.isFinite(resaleUnitPrice)) {
        throw createError(422, 'The selected markup produces an invalid resale price.');
      }
      return {
        product: product._id,
        variant: variant._id,
        productName: product.name?.en || '',
        variantName: variant.name?.en || variant.name || '',
        sku: variant.sku || '',
        quantity: item.quantity,
        unitCost,
        resaleUnitPrice,
        resaleTotal: Math.round(resaleUnitPrice * item.quantity * 100) / 100,
      };
    });
    const subtotal = Math.round(quoteItems.reduce((sum, item) => sum + item.resaleTotal, 0) * 100) / 100;
    const quote = await Quote.create({
      user: user._id,
      company: company._id,
      status: 'draft',
      enquiryQueue: 'commercial',
      subtotal,
      total: subtotal,
      dealerQuote: {
        createdBy: user._id,
        markupPercent,
        items: quoteItems,
        subtotal,
        total: subtotal,
      },
      statusHistory: [{ status: 'draft', changedBy: user._id, note: 'Dealer resale quote created.' }],
    });
    res.status(201).json({
      success: true,
      data: {
        _id: quote._id,
        referenceNumber: quote.referenceNumber,
        status: quote.status,
        dealerQuote: quote.dealerQuote,
        createdAt: quote.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/dealer/quotes', async (req, res, next) => {
  try {
    const { company } = await activeCompany(req, 'dealer');
    const quotes = await Quote.find({ company: company._id })
      .select('referenceNumber status items subtotal total currency expiresAt createdAt orderId dealerQuote')
      .sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, data: quotes });
  } catch (error) {
    next(error);
  }
});

router.get('/dealer/quotes/:id', async (req, res, next) => {
  try {
    const { company } = await activeCompany(req, 'dealer');
    if (!validId(req.params.id)) {return next(createError(400, 'Invalid quote ID.'));}
    const quote = await Quote.findOne({ _id: req.params.id, company: company._id })
      .select('referenceNumber status dealerQuote currency createdAt expiresAt')
      .lean();
    if (!quote) {return next(createError(404, 'Dealer quote not found.'));}
    res.json({ success: true, data: quote });
  } catch (error) {
    next(error);
  }
});

router.post('/dealer/claims/upload-url', rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'rl:dealer-claim-upload' }), async (req, res, next) => {
  try {
    const { company } = await activeCompany(req, 'dealer');
    const { filename, contentType, sizeBytes } = req.body || {};
    if (typeof filename !== 'string' || !CLAIM_PHOTO_TYPES.has(contentType) ||
      !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 10 * 1024 * 1024) {
      return next(createError(400, 'Warranty photos must be JPEG, PNG, WebP, or HEIC and no larger than 10 MB.'));
    }
    const upload = await s3.getSignedUploadUrl(
      'private', 'dealer-claims', String(company._id), filename, contentType, 10 * 1024 * 1024, 900,
    );
    res.json({ success: true, data: upload });
  } catch (error) {
    next(error);
  }
});

router.post('/dealer/claims', rateLimit({ windowMs: 60_000, max: 5, keyPrefix: 'rl:dealer-claim' }), async (req, res, next) => {
  try {
    const { user, company } = await activeCompany(req, 'dealer');
    const model = clean(req.body?.model, 200);
    const issue = clean(req.body?.issue, 5000);
    const serialNumber = clean(req.body?.serialNumber, 120);
    const photos = Array.isArray(req.body?.photos) ? req.body.photos : [];
    if (model.length < 2 || issue.length < 10 || photos.length > 5) {
      return next(createError(400, 'A product model, detailed issue, and no more than five photos are required.'));
    }
    let order = null;
    if (req.body?.orderId) {
      if (!validId(req.body.orderId)) {return next(createError(400, 'Invalid order ID.'));}
      order = await Order.findOne({ _id: req.body.orderId, company: company._id }).select('_id');
      if (!order) {return next(createError(404, 'Company order not found.'));}
    }
    const resolvedPhotos = await Promise.all(photos.map(async (photo) => {
      const key = typeof photo?.key === 'string' ? photo.key : '';
      const prefix = `${process.env.NODE_ENV || 'development'}/dealer-claims/${company._id}/`;
      if (!key.startsWith(prefix)) {throw createError(400, 'One or more warranty photos are invalid.');}
      const file = await s3.headFile(key, 'private');
      if (!file.exists || !CLAIM_PHOTO_TYPES.has(file.contentType) ||
        !Number.isSafeInteger(file.contentLength) || file.contentLength < 1 || file.contentLength > 10 * 1024 * 1024) {
        throw createError(400, 'A warranty photo has an unsupported type or size.');
      }
      return { key, filename: s3.sanitiseFilename(clean(photo.filename, 180) || 'warranty-photo'), contentType: file.contentType, sizeBytes: file.contentLength };
    }));
    const claim = await DealerWarrantyClaim.create({
      company: company._id,
      user: user._id,
      order: order?._id || null,
      model,
      serialNumber,
      issue,
      photos: resolvedPhotos,
    });
    res.status(201).json({ success: true, data: { _id: claim._id, status: claim.status }, message: 'Warranty claim submitted.' });
  } catch (error) {
    next(error);
  }
});

router.get('/dealer/claims', async (req, res, next) => {
  try {
    const { company } = await activeCompany(req, 'dealer');
    const claims = await DealerWarrantyClaim.find({ company: company._id })
      .select('-photos.key')
      .populate('order', 'orderNumber status')
      .sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, data: claims });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
