'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ConsentRecord = require('../../models/ConsentRecord');
const { recordConsent } = require('../../controllers/privacyController');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe('Privacy consent records', () => {
  it('stores timestamped explicit optional-category choices', async () => {
    const originalCreate = ConsentRecord.create;
    ConsentRecord.create = async (input) => ({ _id: 'consent-1', ...input });
    try {
      const response = responseRecorder();
      await recordConsent({
        body: {
          consentId: '8a15f0d9-2dd8-4cad-962d-3704c4676f12',
          analytics: true,
          marketing: false,
        },
      }, response, (error) => { throw error; });

      assert.equal(response.statusCode, 201);
      assert.equal(response.body.data.policyVersion, '2026-10');
      assert.equal(response.body.data.recordedAt instanceof Date, true);
    } finally {
      ConsentRecord.create = originalCreate;
    }
  });

  it('rejects malformed consent identifiers and non-boolean choices', async () => {
    const response = responseRecorder();
    let error;
    await recordConsent({
      body: { consentId: 'not-a-uuid', analytics: 'yes', marketing: false },
    }, response, (value) => { error = value; });
    assert.equal(error?.statusCode, 400);
  });
});
