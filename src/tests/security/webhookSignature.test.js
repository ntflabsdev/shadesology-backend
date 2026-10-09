'use strict';

const { createHmac } = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.STRIPE_WEBHOOK_SECRET = 'test-stripe-webhook-secret';
const { verifyStripeSignature } = require('../../controllers/paymentController');

function stripeSignature(body, timestamp) {
  const digest = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.`)
    .update(body)
    .digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

test('Stripe webhook signature accepts the original signed payload', () => {
  const body = Buffer.from('{"id":"evt_test","type":"checkout.session.completed"}');
  const timestamp = Math.floor(Date.now() / 1000);

  assert.equal(verifyStripeSignature(body, stripeSignature(body, timestamp)), true);
});

test('Stripe webhook signature rejects modified and stale payloads', () => {
  const body = Buffer.from('{"id":"evt_test"}');
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = stripeSignature(body, timestamp);
  const staleSignature = stripeSignature(body, timestamp - 301);

  assert.equal(verifyStripeSignature(Buffer.from('{"id":"evt_other"}'), signature), false);
  assert.equal(verifyStripeSignature(body, staleSignature), false);
});
