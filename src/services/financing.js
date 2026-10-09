'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');

function calculateMonthlyPayment(principal, annualAprPercent, termMonths) {
  if (!Number.isFinite(principal) || principal < 0) {throw new Error('Principal must be a non-negative amount.');}
  if (!Number.isFinite(annualAprPercent) || annualAprPercent < 0 || annualAprPercent > 100) {
    throw new Error('APR must be between 0 and 100 percent.');
  }
  if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > 360) {
    throw new Error('Term must be between 1 and 360 months.');
  }
  if (principal === 0) {return 0;}
  const monthlyRate = annualAprPercent / 100 / 12;
  if (monthlyRate === 0) {return Math.round((principal / termMonths) * 100) / 100;}
  const payment = principal * monthlyRate / (1 - ((1 + monthlyRate) ** -termMonths));
  return Math.round(payment * 100) / 100;
}

function getFinancingMode() {
  const mode = (process.env.FINANCING_MODE || 'sandbox').toLowerCase();
  if (!['sandbox', 'live'].includes(mode)) {
    throw new Error('FINANCING_MODE must be "sandbox" or "live".');
  }
  return mode;
}

function getHostedApplicationUrl({ reference, amount, returnUrl }) {
  const mode = getFinancingMode();
  const provider = (process.env.FINANCING_PROVIDER || 'greensky').toLowerCase();
  if (provider !== 'greensky') {
    throw new Error('Only the GreenSky hosted-application adapter is currently supported.');
  }
  const configuredUrl = mode === 'live'
    ? process.env.FINANCING_APPLICATION_URL_LIVE
    : process.env.FINANCING_APPLICATION_URL_SANDBOX;
  const merchantId = process.env.FINANCING_MERCHANT_ID;
  if (!configuredUrl || !merchantId) {
    return {
      available: false,
      reason: 'The financing provider is not configured. You can still review estimated payments or contact our team.',
    };
  }

  let destination;
  try {
    destination = new URL(configuredUrl);
  } catch {
    throw new Error('The configured financing application URL is invalid.');
  }
  if (destination.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    throw new Error('Live financing application URLs must use HTTPS.');
  }
  destination.searchParams.set('merchant_id', merchantId);
  destination.searchParams.set('reference_id', reference);
  destination.searchParams.set('amount', Number(amount).toFixed(2));
  destination.searchParams.set('return_url', returnUrl);
  return { available: true, url: destination.toString(), mode, provider };
}

function signProviderCallback({ applicationId, status, approvedAmount = '', providerReference = '' }, secret) {
  return createHmac('sha256', secret)
    .update(`${applicationId}|${status}|${approvedAmount}|${providerReference}`)
    .digest('hex');
}

function verifyProviderCallback(payload, signature, secret) {
  if (!secret || !signature || !/^[a-f0-9]{64}$/i.test(signature)) {return false;}
  const expected = Buffer.from(signProviderCallback(payload, secret), 'hex');
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function isAllowedApplicationTransition(currentStatus, nextStatus) {
  const transitions = {
    started: ['prequalified', 'approved', 'declined', 'abandoned'],
    prequalified: ['approved', 'declined', 'abandoned'],
    approved: ['declined'],
    declined: [],
    abandoned: [],
  };
  return (transitions[currentStatus] || []).includes(nextStatus);
}

module.exports = {
  calculateMonthlyPayment,
  getFinancingMode,
  getHostedApplicationUrl,
  signProviderCallback,
  verifyProviderCallback,
  isAllowedApplicationTransition,
};
