'use strict';

const { randomUUID } = require('node:crypto');
const FinancingApplication = require('../models/FinancingApplication');
const FinancingOffer = require('../models/FinancingOffer');
const { getQueue } = require('../queues');
const financing = require('../services/financing');
const { createError } = require('../middlewares/errorHandler');
const { resolveLeadRecipient } = require('../services/leadRouting');

function parseAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && Math.round(amount * 100) === amount * 100
    ? amount
    : null;
}

function cleanString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function getFinancingOptions(req, res, next) {
  try {
    const amount = req.query.amount === undefined ? null : parseAmount(req.query.amount);
    if (req.query.amount !== undefined && amount === null) {
      return next(createError(400, 'amount must be a positive amount with no more than two decimal places.'));
    }
    const now = new Date();
    const filter = {
      isActive: true,
      startsAt: { $lte: now },
      endsAt: { $gt: now },
    };
    if (amount !== null) {
      filter.minimumAmount = { $lte: amount };
      filter.$or = [{ maximumAmount: null }, { maximumAmount: { $gte: amount } }];
    }
    const offers = await FinancingOffer.find(filter).sort({ termMonths: 1, apr: 1 }).lean();
    const mode = financing.getFinancingMode();
    const providerConfigured = Boolean(
      process.env.FINANCING_MERCHANT_ID &&
      (mode === 'live' ? process.env.FINANCING_APPLICATION_URL_LIVE : process.env.FINANCING_APPLICATION_URL_SANDBOX)
    );
    res.json({
      success: true,
      data: {
        provider: (process.env.FINANCING_PROVIDER || 'greensky').toLowerCase(),
        mode,
        applicationAvailable: providerConfigured,
        offers: offers.map(({ _id, name, offerType, apr, standardApr, termMonths, minimumAmount, maximumAmount, lenderDisclosure, startsAt, endsAt }) => ({
          _id, name, offerType, apr, standardApr, termMonths, minimumAmount, maximumAmount, lenderDisclosure, startsAt, endsAt,
        })),
        representativeApr: Number(process.env.FINANCING_REPRESENTATIVE_APR || 12.99),
        representativeTermMonths: Number(process.env.FINANCING_REPRESENTATIVE_TERM_MONTHS || 120),
        representativeDisclosure: process.env.FINANCING_REPRESENTATIVE_DISCLOSURE || 'Estimated payment only; this is not a credit offer or commitment. Actual terms, eligibility, APR, and payment are determined by the lender after application.',
      },
    });
  } catch (err) {
    next(err);
  }
}

async function createConsumerApplication(req, res, next) {
  try {
    const { firstName, lastName, email, amount, consent } = req.body;
    const requestedAmount = parseAmount(amount);
    if (!cleanString(firstName, 100) || !cleanString(lastName, 100) || !validEmail(email) || !requestedAmount) {
      return next(createError(400, 'First name, last name, valid email, and a positive amount are required.'));
    }
    if (consent !== true) {
      return next(createError(400, 'Consent to share your application details with the financing provider is required.'));
    }
    const reference = randomUUID();
    const provider = (process.env.FINANCING_PROVIDER || 'greensky').toLowerCase();
    const application = await FinancingApplication.create({
      reference,
      applicationType: 'consumer',
      status: 'started',
      firstName: cleanString(firstName, 100),
      lastName: cleanString(lastName, 100),
      email: email.trim().toLowerCase(),
      requestedAmount,
      provider,
      consentAt: new Date(),
      statusHistory: [{ status: 'started' }],
    });
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    let handoff;
    try {
      handoff = financing.getHostedApplicationUrl({
        reference,
        amount: requestedAmount,
        returnUrl: `${frontendUrl}/financing/status?reference=${encodeURIComponent(reference)}`,
      });
    } catch (err) {
      application.status = 'handoff_unavailable';
      application.statusHistory.push({ status: 'handoff_unavailable' });
      await application.save();
      throw err;
    }
    if (!handoff.available) {
      application.status = 'handoff_unavailable';
      application.statusHistory.push({ status: 'handoff_unavailable' });
      await application.save();
      return res.status(503).json({
        success: false,
        message: handoff.reason,
        data: { reference, status: application.status, leadRecorded: true },
      });
    }
    application.provider = handoff.provider;
    await application.save();
    res.status(201).json({
      success: true,
      data: { reference, status: application.status, redirectUrl: handoff.url, mode: handoff.mode },
    });
  } catch (err) {
    next(err);
  }
}

async function createLeaseApplication(req, res, next) {
  try {
    const { firstName, lastName, email, company, amount, consent } = req.body;
    const requestedAmount = parseAmount(amount);
    if (!cleanString(firstName, 100) || !cleanString(lastName, 100) || !validEmail(email) || !cleanString(company, 200) || !requestedAmount) {
      return next(createError(400, 'First name, last name, company, valid email, and a positive amount are required.'));
    }
    if (consent !== true) {
      return next(createError(400, 'Consent to contact you about this lease inquiry is required.'));
    }
    const reference = randomUUID();
    const application = await FinancingApplication.create({
      reference,
      applicationType: 'commercial_lease',
      status: 'started',
      firstName: cleanString(firstName, 100),
      lastName: cleanString(lastName, 100),
      email: email.trim().toLowerCase(),
      company: cleanString(company, 200),
      requestedAmount,
      provider: (process.env.FINANCING_PROVIDER || 'greensky').toLowerCase(),
      consentAt: new Date(),
      statusHistory: [{ status: 'started' }],
    });
    let staffEmail = '';
    try {
      staffEmail = await resolveLeadRecipient({
        enquiryType: 'commercial_lease',
        productType: '',
        region: cleanString(req.body.region, 100),
      });
    } catch (err) {
      console.error('[Financing] Could not resolve commercial lease routing; inquiry remains stored:', err.message);
    }
    if (staffEmail) {
      await getQueue('email').add('send', {
        to: staffEmail,
        subject: `Commercial lease inquiry ${reference}`,
        text: `A commercial lease inquiry was received.\nApplicant: ${application.firstName} ${application.lastName}\nCompany: ${application.company}\nEmail: ${application.email}\nRequested amount: $${application.requestedAmount.toFixed(2)}\nReference: ${reference}`,
        html: `<p>A commercial lease inquiry was received.</p><p>Applicant: ${application.firstName} ${application.lastName}<br>Company: ${application.company}<br>Email: ${application.email}<br>Requested amount: $${application.requestedAmount.toFixed(2)}<br>Reference: ${reference}</p>`,
      }, { jobId: `lease-lead-${reference}`, attempts: 5 });
    }
    res.status(201).json({ success: true, data: { reference, message: 'Your leasing inquiry has been recorded. Our commercial team will contact you.' } });
  } catch (err) {
    next(err);
  }
}

async function getApplicationStatus(req, res, next) {
  try {
    const application = await FinancingApplication.findOne({ reference: req.params.reference })
      .select('reference applicationType status requestedAmount approvedAmount providerReference createdAt updatedAt')
      .lean();
    if (!application) {return next(createError(404, 'Financing application not found.'));}
    res.json({ success: true, data: application });
  } catch (err) {
    next(err);
  }
}

async function handleProviderCallback(req, res, next) {
  try {
    const { reference, status, approvedAmount, providerReference = '' } = req.body;
    const amount = approvedAmount === undefined ? '' : String(approvedAmount);
    if (!reference || !['prequalified', 'approved', 'declined', 'abandoned'].includes(status)) {
      return next(createError(400, 'A valid application reference and provider status are required.'));
    }
    if (status === 'approved' && parseAmount(approvedAmount) === null) {
      return next(createError(400, 'approvedAmount must be a positive amount with at most two decimal places.'));
    }
    if (typeof providerReference !== 'string' || providerReference.length > 200) {
      return next(createError(400, 'providerReference is invalid.'));
    }
    const payload = { applicationId: reference, status, approvedAmount: amount, providerReference };
    if (!financing.verifyProviderCallback(payload, req.get('x-financing-signature'), process.env.FINANCING_WEBHOOK_SECRET)) {
      return next(createError(400, 'Invalid financing provider callback signature.'));
    }
    const application = await FinancingApplication.findOne({ reference });
    if (!application || application.applicationType !== 'consumer') {
      return next(createError(404, 'Consumer financing application not found.'));
    }
    if (application.status === status &&
      Number(application.approvedAmount || 0) === Number(approvedAmount || 0) &&
      application.providerReference === providerReference) {
      return res.json({ success: true, duplicate: true });
    }
    if (!financing.isAllowedApplicationTransition(application.status, status)) {
      return next(createError(409, `Cannot change financing application status from ${application.status} to ${status}.`));
    }
    application.status = status;
    application.approvedAmount = status === 'approved' ? Number(approvedAmount) : undefined;
    application.providerReference = providerReference;
    application.statusHistory.push({ status, providerReference });
    await application.save();
    res.json({ success: true, data: { reference, status: application.status, approvedAmount: application.approvedAmount } });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getFinancingOptions,
  createConsumerApplication,
  createLeaseApplication,
  getApplicationStatus,
  handleProviderCallback,
};
