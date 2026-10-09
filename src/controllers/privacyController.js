'use strict';

const { createHash, randomBytes } = require('node:crypto');
const ConsentRecord = require('../models/ConsentRecord');
const PrivacyRequest = require('../models/PrivacyRequest');
const User = require('../models/User');
const Order = require('../models/Order');
const Quote = require('../models/Quote');
const NewsletterSubscriber = require('../models/NewsletterSubscriber');
const Lead = require('../models/Lead');
const WarrantyRegistration = require('../models/WarrantyRegistration');
const FinancingApplication = require('../models/FinancingApplication');
const AuditLog = require('../models/AuditLog');
const { getQueue } = require('../queues');
const { isRedisEnabled } = require('../config/redis');
const emailService = require('../services/email');
const { createError } = require('../middlewares/errorHandler');

const POLICY_VERSION = process.env.PRIVACY_POLICY_VERSION || '2026-10';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function safeUser(user) {
  if (!user) {return null;}
  const record = user.toObject ? user.toObject() : { ...user };
  for (const key of [
    'passwordHash',
    'emailVerificationToken',
    'emailVerificationExpires',
    'passwordResetToken',
    'passwordResetExpires',
    'tokenVersion',
  ]) {delete record[key];}
  return record;
}

async function recordAudit(type, emailHash, requestId) {
  await AuditLog.create({
    event: 'privacy_request',
    meta: { requestType: type, emailHash, requestId: String(requestId) },
  });
}

async function recordConsent(req, res, next) {
  try {
    const { consentId, analytics, marketing } = req.body || {};
    if (
      typeof consentId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(consentId) ||
      typeof analytics !== 'boolean' ||
      typeof marketing !== 'boolean'
    ) {
      return next(createError(400, 'A valid consent ID and explicit analytics/marketing choices are required.'));
    }

    const record = await ConsentRecord.create({
      consentId,
      user: req.user?._id || null,
      necessary: true,
      analytics,
      marketing,
      policyVersion: POLICY_VERSION,
      recordedAt: new Date(),
    });

    if (req.user?._id) {
      await User.updateOne({ _id: req.user._id }, { $set: { marketingConsent: marketing } });
    }

    res.status(201).json({
      success: true,
      data: { id: record._id, recordedAt: record.recordedAt, policyVersion: POLICY_VERSION },
    });
  } catch (err) {
    next(err);
  }
}

async function submitRequest(req, res, next) {
  try {
    const email = normalizeEmail(req.body?.email);
    const type = req.body?.type;
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      return next(createError(400, 'Enter a valid email address.'));
    }
    if (!['access', 'deletion', 'do_not_sell'].includes(type)) {
      return next(createError(400, 'Choose a supported privacy request type.'));
    }
    if (type === 'deletion' && !isRedisEnabled()) {
      return next(createError(503, 'Secure deletion processing is temporarily unavailable. Please try again later.'));
    }

    const rawToken = randomBytes(32).toString('hex');
    const request = await PrivacyRequest.create({
      type,
      email,
      emailHash: digest(email),
      verificationTokenHash: digest(rawToken),
      verificationExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      status: 'verification_pending',
    });

    const siteUrl = process.env.FRONTEND_URL || process.env.SITE_URL || 'http://localhost:3000';
    const verificationUrl = new URL('/privacy', siteUrl);
    verificationUrl.searchParams.set('token', rawToken);
    try {
      await emailService.send({
        to: email,
        subject: 'Verify your Shadesology privacy request',
        text: `Verify your privacy request within 30 minutes: ${verificationUrl.toString()}`,
        html: `<p>We received a privacy request for this email address.</p><p><a href="${verificationUrl.toString()}">Verify and continue</a>. This link expires in 30 minutes.</p><p>If you did not make this request, you can ignore this message.</p>`,
      });
    } catch (err) {
      await PrivacyRequest.updateOne(
        { _id: request._id },
        { $set: { status: 'failed', failureCode: 'verification_email_failed' } },
      );
      throw err;
    }

    await recordAudit(type, request.emailHash, request._id);
    res.status(202).json({
      success: true,
      message: 'If the request can be processed, a verification link has been sent to that email address.',
    });
  } catch (err) {
    next(err);
  }
}

async function verifyRequest(req, res, next) {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return next(createError(400, 'The verification link is invalid or expired.'));
    }
    const request = await PrivacyRequest.findOne({
      verificationTokenHash: digest(token),
      verificationExpiresAt: { $gt: new Date() },
      status: 'verification_pending',
    }).select('+email +verificationTokenHash +verificationExpiresAt');
    if (!request || !request.email) {
      return next(createError(400, 'The verification link is invalid or expired.'));
    }

    request.verifiedAt = new Date();
    request.verificationTokenHash = null;
    request.verificationExpiresAt = null;

    if (request.type === 'deletion') {
      const queue = getQueue('privacy');
      request.status = 'queued';
      await request.save();
      try {
        await queue.add('delete-data-subject', { requestId: String(request._id) }, {
          jobId: `privacy-delete-${request._id}`,
          attempts: 8,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 200 },
          removeOnFail: { count: 500 },
        });
      } catch (err) {
        await PrivacyRequest.updateOne(
          { _id: request._id },
          { $set: { status: 'failed', failureCode: 'queue_unavailable' } },
        );
        throw err;
      }
      return res.status(202).json({
        success: true,
        message: 'Your verified deletion request is queued for secure processing.',
      });
    }

    if (request.type === 'do_not_sell') {
      await User.updateOne({ email: request.email }, { $set: { marketingConsent: false } });
      await NewsletterSubscriber.findOneAndUpdate(
        { email: request.email },
        {
          $set: { status: 'unsubscribed', consentGiven: false, unsubscribedAt: new Date() },
          $setOnInsert: { source: 'manual' },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      request.status = 'completed';
      request.completedAt = new Date();
      request.email = null;
      await request.save();
      return res.json({ success: true, message: 'Your opt-out request has been applied.' });
    }

    const user = await User.findOne({ email: request.email }).select(
      '-passwordHash -emailVerificationToken -emailVerificationExpires -passwordResetToken -passwordResetExpires -tokenVersion',
    ).lean();
    const related = user?._id
      ? { $or: [{ user: user._id }, { guestEmail: request.email }] }
      : { guestEmail: request.email };
    const [orders, quotes, leads, warrantyRegistrations, financingApplications, consentRecords, newsletter] = await Promise.all([
      Order.find(related).lean(),
      Quote.find(user?._id
        ? { $or: [{ user: user._id }, { 'guestContact.email': request.email }] }
        : { 'guestContact.email': request.email }).lean(),
      Lead.find({ email: request.email }).lean(),
      WarrantyRegistration.find({ email: request.email }).lean(),
      FinancingApplication.find({ email: request.email }).lean(),
      user?._id ? ConsentRecord.find({ user: user._id }).lean() : Promise.resolve([]),
      NewsletterSubscriber.findOne({ email: request.email }).lean(),
    ]);

    request.status = 'completed';
    request.completedAt = new Date();
    request.email = null;
    await request.save();
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true,
      data: {
        exportedAt: new Date().toISOString(),
        account: safeUser(user),
        orders,
        quotes,
        leads,
        warrantyRegistrations,
        financingApplications,
        consentRecords,
        newsletter,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { recordConsent, submitRequest, verifyRequest };
