'use strict';

const { Worker } = require('bullmq');
const { createHash } = require('node:crypto');
const { createRedisConnection, isRedisEnabled } = require('../config/redis');
const PrivacyRequest = require('../models/PrivacyRequest');
const User = require('../models/User');
const Order = require('../models/Order');
const Quote = require('../models/Quote');
const Cart = require('../models/Cart');
const Review = require('../models/Review');
const Installer = require('../models/Installer');
const ApprovalRequest = require('../models/ApprovalRequest');
const Lead = require('../models/Lead');
const Company = require('../models/Company');
const NewsletterSubscriber = require('../models/NewsletterSubscriber');
const WarrantyRegistration = require('../models/WarrantyRegistration');
const FinancingApplication = require('../models/FinancingApplication');
const ConsentRecord = require('../models/ConsentRecord');
const AuditLog = require('../models/AuditLog');
const s3 = require('../services/s3');
const hubspot = require('../services/hubspot');

function emailHash(email) {
  return createHash('sha256').update(email).digest('hex');
}

function collectKey(keys, value) {
  if (typeof value === 'string' && value && !/^https?:\/\//i.test(value)) {keys.add(value);}
}

async function deleteDataSubject(requestId) {
  const request = await PrivacyRequest.findById(requestId).select('+email');
  if (request?.status === 'completed') {
    return { alreadyCompleted: true };
  }
  if (!request || request.type !== 'deletion' || !request.email) {
    throw new Error('Verified privacy deletion request is missing its subject email.');
  }

  const email = request.email;
  const user = await User.findOne({ email }).select('_id company').lean();
  const userId = user?._id || null;
  const privateKeys = new Set();
  const quoteFilter = userId
    ? { $or: [{ user: userId }, { 'guestContact.email': email }] }
    : { 'guestContact.email': email };
  const leadRecords = await Lead.find({ email }).select('attachments.s3Key').lean();
  const quoteRecords = await Quote.find(quoteFilter)
    .select('attachments.s3Key pdfS3Key')
    .lean();
  const installerFilter = userId
    ? { $or: [{ user: userId }, { email }] }
    : { email };
  const installers = await Installer.find(installerFilter)
    .select('privateDocuments.key insuranceFileUrl')
    .lean();
  const approvalRecords = userId
    ? await ApprovalRequest.find({ applicant: userId }).select('documents.fileUrl').lean()
    : [];

  for (const lead of leadRecords) {
    for (const attachment of lead.attachments || []) {collectKey(privateKeys, attachment.s3Key);}
  }
  for (const quote of quoteRecords) {
    for (const attachment of quote.attachments || []) {collectKey(privateKeys, attachment.s3Key);}
    collectKey(privateKeys, quote.pdfS3Key);
  }
  for (const installer of installers) {
    for (const document of installer.privateDocuments || []) {collectKey(privateKeys, document.key);}
    collectKey(privateKeys, installer.insuranceFileUrl);
  }
  for (const approval of approvalRecords) {
    for (const document of approval.documents || []) {collectKey(privateKeys, document.fileUrl);}
  }

  for (const key of privateKeys) {await s3.deleteFile(key, 'private');}
  await hubspot.deleteContactByEmail(email);

  await Promise.all([
    Quote.deleteMany(quoteFilter),
    Lead.deleteMany({ email }),
    Installer.deleteMany(installerFilter),
    ApprovalRequest.deleteMany(userId ? { applicant: userId } : { _id: { $exists: false } }),
    Review.deleteMany(userId ? { user: userId } : { _id: { $exists: false } }),
    WarrantyRegistration.deleteMany({ email }),
    FinancingApplication.updateMany(
      { email },
      {
        $set: {
          firstName: 'Deleted',
          lastName: 'Customer',
          email: `deleted+${emailHash(email)}@privacy.invalid`,
          company: '',
          providerReference: '',
          'statusHistory.$[].providerReference': '',
        },
      },
    ),
    userId
      ? Company.updateMany(
        { $or: [{ companyAdmin: userId }, { approvedBy: userId }] },
        { $set: { companyAdmin: null, approvedBy: null } },
      )
      : Promise.resolve(),
    Company.updateMany(
      { email },
      { $set: { email: '', phone: '' } },
    ),
    userId
      ? ApprovalRequest.updateMany(
        { $or: [{ assignedTo: userId }, { resolvedBy: userId }] },
        { $set: { assignedTo: null, resolvedBy: null } },
      )
      : Promise.resolve(),
    userId
      ? Review.updateMany(
        { moderatedBy: userId },
        { $set: { moderatedBy: null } },
      )
      : Promise.resolve(),
    Cart.deleteMany(userId
      ? { $or: [{ user: userId }, { contactEmail: email }] }
      : { contactEmail: email }),
    NewsletterSubscriber.deleteOne({ email }),
    userId ? ConsentRecord.deleteMany({ user: userId }) : Promise.resolve(),
    Order.updateMany(
      userId
        ? { $or: [{ user: userId }, { guestEmail: email }] }
        : { guestEmail: email },
      {
        $set: {
          user: null,
          guestEmail: null,
          guestName: 'Deleted customer',
          'shippingAddress.firstName': '',
          'shippingAddress.lastName': '',
          'shippingAddress.company': '',
          'shippingAddress.line1': '',
          'shippingAddress.line2': '',
          'shippingAddress.city': '',
          'shippingAddress.state': '',
          'shippingAddress.zip': '',
          'shippingAddress.phone': '',
          'billingAddress.firstName': '',
          'billingAddress.lastName': '',
          'billingAddress.company': '',
          'billingAddress.line1': '',
          'billingAddress.line2': '',
          'billingAddress.city': '',
          'billingAddress.state': '',
          'billingAddress.zip': '',
          'billingAddress.phone': '',
          cancellationReason: '',
          customerRequests: [],
          'statusHistory.$[].note': '',
          'statusHistory.$[].changedBy': null,
          'refunds.$[].reason': '',
        },
      },
    ),
    User.deleteOne({ email }),
  ]);

  const hash = `sha256:${emailHash(email)}`;
  const actorCriteria = [{ actorEmail: email }];
  const subjectCriteria = [{ subjectEmail: email }];
  if (userId) {
    actorCriteria.push({ actor: userId });
    subjectCriteria.push({ subject: userId });
  }
  await AuditLog.collection.updateMany(
    { $or: actorCriteria },
    {
      $set: {
        actor: null,
        actorEmail: hash,
        ip: '',
        userAgent: '',
        meta: { privacyRedacted: true },
      },
    },
  );
  await AuditLog.collection.updateMany(
    { $or: subjectCriteria },
    {
      $set: {
        subject: null,
        subjectEmail: hash,
        ip: '',
        userAgent: '',
        meta: { privacyRedacted: true },
      },
    },
  );

  await AuditLog.create({
    event: 'privacy_request',
    meta: {
      requestType: 'deletion',
      outcome: 'completed',
      emailHash: emailHash(email),
      requestId: String(request._id),
      retainedOrderRecords: true,
    },
  });

  request.status = 'completed';
  request.completedAt = new Date();
  request.failureCode = '';
  request.email = null;
  await request.save();
  await PrivacyRequest.updateMany(
    { _id: { $ne: request._id }, email },
    { $set: { email: null, status: 'completed', completedAt: new Date() } },
  );

  return { requestId: String(request._id), deletedFiles: privateKeys.size };
}

let worker = null;

function start() {
  if (!isRedisEnabled()) {
    console.info('[PrivacyWorker] Redis disabled — deletion jobs are unavailable.');
    return;
  }
  if (worker) {return;}

  const connection = createRedisConnection();
  if (!connection) {return;}
  worker = new Worker('privacy', async (job) => {
    if (job.name !== 'delete-data-subject') {throw new Error(`Unknown privacy job: ${job.name}`);}
    const existing = await PrivacyRequest.findById(job.data.requestId).select('+email');
    if (!existing || existing.status === 'completed' || !existing.email) {
      return { alreadyCompleted: true };
    }
    const request = await PrivacyRequest.findByIdAndUpdate(
      job.data.requestId,
      { $set: { status: 'processing', failureCode: '' } },
      { new: true },
    ).select('+email');
    if (!request || !request.email) {return { alreadyCompleted: true };}

    try {
      return await deleteDataSubject(job.data.requestId);
    } catch (err) {
      if (job.attemptsMade + 1 >= (job.opts.attempts || 1)) {
        await PrivacyRequest.updateOne(
          { _id: job.data.requestId },
          { $set: { status: 'failed', failureCode: 'processing_failed' } },
        );
      }
      throw err;
    }
  }, { connection, concurrency: 1 });

  worker.on('completed', (job) => console.info(`[PrivacyWorker] deletion completed (${job.id}).`));
  worker.on('failed', (job, err) => console.error(`[PrivacyWorker] job ${job?.id} failed: ${err.message}`));
  worker.on('error', (err) => console.error(`[PrivacyWorker] worker error: ${err.message}`));
}

async function stop() {
  if (!worker) {return;}
  await worker.close();
  worker = null;
}

module.exports = { start, stop, deleteDataSubject };
