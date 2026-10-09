'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateMonthlyPayment,
  getFinancingMode,
  getHostedApplicationUrl,
  signProviderCallback,
  verifyProviderCallback,
  isAllowedApplicationTransition,
} = require('../../services/financing');

describe('Financing service', () => {
  it('calculates zero-APR and amortized payments to cents', () => {
    assert.equal(calculateMonthlyPayment(1200, 0, 12), 100);
    assert.equal(calculateMonthlyPayment(1200, 12, 12), 106.62);
    assert.equal(calculateMonthlyPayment(0, 12, 12), 0);
  });

  it('rejects invalid calculation inputs and financing modes', () => {
    assert.throws(() => calculateMonthlyPayment(-1, 10, 12), /Principal/);
    assert.throws(() => calculateMonthlyPayment(100, 101, 12), /APR/);
    assert.throws(() => calculateMonthlyPayment(100, 10, 0), /Term/);
    const previous = process.env.FINANCING_MODE;
    process.env.FINANCING_MODE = 'production';
    assert.throws(() => getFinancingMode(), /FINANCING_MODE/);
    if (previous === undefined) {delete process.env.FINANCING_MODE;}
    else {process.env.FINANCING_MODE = previous;}
  });

  it('uses explicit hosted provider config and falls back when it is absent', () => {
    const previous = {
      mode: process.env.FINANCING_MODE,
      merchant: process.env.FINANCING_MERCHANT_ID,
      sandbox: process.env.FINANCING_APPLICATION_URL_SANDBOX,
      live: process.env.FINANCING_APPLICATION_URL_LIVE,
    };
    process.env.FINANCING_MODE = 'sandbox';
    process.env.FINANCING_MERCHANT_ID = 'merchant-test';
    process.env.FINANCING_APPLICATION_URL_SANDBOX = 'https://lender.example/apply';
    process.env.FINANCING_APPLICATION_URL_LIVE = '';
    const result = getHostedApplicationUrl({ reference: 'ref-1', amount: 123.4, returnUrl: 'https://shop.example/return' });
    assert.equal(result.available, true);
    const url = new URL(result.url);
    assert.equal(url.searchParams.get('amount'), '123.40');
    assert.equal(url.searchParams.get('reference_id'), 'ref-1');
    assert.equal(url.searchParams.get('merchant_id'), 'merchant-test');
    assert.equal(getHostedApplicationUrl({ reference: 'ref-2', amount: 10, returnUrl: 'https://shop.example/return' }).available, true);
    delete process.env.FINANCING_APPLICATION_URL_SANDBOX;
    assert.equal(getHostedApplicationUrl({ reference: 'ref-3', amount: 10, returnUrl: 'https://shop.example/return' }).available, false);
    if (previous.mode === undefined) {delete process.env.FINANCING_MODE;} else {process.env.FINANCING_MODE = previous.mode;}
    if (previous.merchant === undefined) {delete process.env.FINANCING_MERCHANT_ID;} else {process.env.FINANCING_MERCHANT_ID = previous.merchant;}
    if (previous.sandbox === undefined) {delete process.env.FINANCING_APPLICATION_URL_SANDBOX;} else {process.env.FINANCING_APPLICATION_URL_SANDBOX = previous.sandbox;}
    if (previous.live === undefined) {delete process.env.FINANCING_APPLICATION_URL_LIVE;} else {process.env.FINANCING_APPLICATION_URL_LIVE = previous.live;}
  });

  it('verifies signed callbacks without accepting altered or malformed signatures', () => {
    const payload = { applicationId: 'ref-1', status: 'approved', approvedAmount: '100', providerReference: 'p-1' };
    const signature = signProviderCallback(payload, 'unit-test-secret');
    assert.equal(verifyProviderCallback(payload, signature, 'unit-test-secret'), true);
    assert.equal(verifyProviderCallback({ ...payload, approvedAmount: '101' }, signature, 'unit-test-secret'), false);
    assert.equal(verifyProviderCallback(payload, 'invalid', 'unit-test-secret'), false);
  });

  it('allows only forward application status transitions', () => {
    assert.equal(isAllowedApplicationTransition('started', 'prequalified'), true);
    assert.equal(isAllowedApplicationTransition('prequalified', 'approved'), true);
    assert.equal(isAllowedApplicationTransition('approved', 'declined'), true);
    assert.equal(isAllowedApplicationTransition('approved', 'prequalified'), false);
    assert.equal(isAllowedApplicationTransition('declined', 'approved'), false);
  });
});
