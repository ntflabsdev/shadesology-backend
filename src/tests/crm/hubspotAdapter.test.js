'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const hubspot = require('../../services/hubspot');

describe('HubSpot adapter security and mode selection', () => {
  it('requires credentials for the selected mode without falling back', () => {
    const prior = {
      mode: process.env.HUBSPOT_MODE,
      sandboxToken: process.env.HUBSPOT_SANDBOX_PRIVATE_APP_TOKEN,
      sandboxPortal: process.env.HUBSPOT_SANDBOX_PORTAL_ID,
      liveToken: process.env.HUBSPOT_LIVE_PRIVATE_APP_TOKEN,
      livePortal: process.env.HUBSPOT_LIVE_PORTAL_ID,
    };
    try {
      process.env.HUBSPOT_MODE = 'sandbox';
      process.env.HUBSPOT_SANDBOX_PRIVATE_APP_TOKEN = 'sandbox-token';
      process.env.HUBSPOT_SANDBOX_PORTAL_ID = '123';
      process.env.HUBSPOT_LIVE_PRIVATE_APP_TOKEN = '';
      process.env.HUBSPOT_LIVE_PORTAL_ID = '';
      assert.doesNotThrow(() => hubspot.validateConfig());
      process.env.HUBSPOT_MODE = 'live';
      assert.throws(() => hubspot.validateConfig(), /HUBSPOT_LIVE_PRIVATE_APP_TOKEN, HUBSPOT_LIVE_PORTAL_ID/);
    } finally {
      for (const [key, value] of Object.entries({
        HUBSPOT_MODE: prior.mode,
        HUBSPOT_SANDBOX_PRIVATE_APP_TOKEN: prior.sandboxToken,
        HUBSPOT_SANDBOX_PORTAL_ID: prior.sandboxPortal,
        HUBSPOT_LIVE_PRIVATE_APP_TOKEN: prior.liveToken,
        HUBSPOT_LIVE_PORTAL_ID: prior.livePortal,
      })) {
        if (value === undefined) {delete process.env[key];}
        else {process.env[key] = value;}
      }
    }
  });

  it('checks v3 webhook signatures against method, exact URL, raw body, and timestamp', () => {
    const priorSecret = process.env.HUBSPOT_WEBHOOK_SECRET;
    const secret = 'hubspot-webhook-test-secret';
    const timestamp = String(Date.now());
    const request = {
      method: 'POST',
      url: 'https://api.example.test/api/webhooks/hubspot',
      body: '[{"eventId":7}]',
      timestamp,
    };
    process.env.HUBSPOT_WEBHOOK_SECRET = secret;
    try {
      const source = `${request.method}${request.url}${request.body}${timestamp}`;
      const signature = crypto.createHmac('sha256', secret).update(source).digest('base64');
      assert.equal(hubspot.verifyWebhookSignature(signature, request), true);
      assert.equal(hubspot.verifyWebhookSignature(signature, { ...request, body: '[]' }), false);
      assert.equal(hubspot.verifyWebhookSignature('invalid', request), false);
      assert.equal(hubspot.verifyWebhookSignature(signature, { ...request, timestamp: '1' }), false);
      const encodedRequest = { ...request, url: `${request.url}?redirect=https%3A%2F%2Fexample.com` };
      const decodedSource = `${encodedRequest.method}https://api.example.test/api/webhooks/hubspot?redirect=https://example.com${encodedRequest.body}${timestamp}`;
      const encodedSignature = crypto.createHmac('sha256', secret).update(decodedSource).digest('base64');
      assert.equal(hubspot.verifyWebhookSignature(encodedSignature, encodedRequest), true);
    } finally {
      if (priorSecret === undefined) {delete process.env.HUBSPOT_WEBHOOK_SECRET;}
      else {process.env.HUBSPOT_WEBHOOK_SECRET = priorSecret;}
    }
  });
});
