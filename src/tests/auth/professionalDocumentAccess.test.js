'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Company = require('../../models/Company');
const { checkProfessionalAudience } = require('../../controllers/download/downloadController');

const originalFindOne = Company.findOne;

after(() => {
  Company.findOne = originalFindOne;
});

test('professional audience files reject unverified, mismatched, and unapproved accounts', async () => {
  const document = { audienceTags: ['specifier'], requiredRole: '', };
  assert.equal(await checkProfessionalAudience(document, null), false);
  assert.equal(await checkProfessionalAudience(document, {
    role: 'specifier',
    isEmailVerified: false,
    company: 'company-id',
  }), false);
  assert.equal(await checkProfessionalAudience(document, {
    role: 'dealer',
    isEmailVerified: true,
    company: 'company-id',
  }), false);

  Company.findOne = () => ({
    select: () => ({
      lean: async () => null,
    }),
  });
  assert.equal(await checkProfessionalAudience(document, {
    role: 'specifier',
    isEmailVerified: true,
    company: 'company-id',
  }), false);
});

test('professional audience files permit matching verified members of approved companies', async () => {
  Company.findOne = (filter) => {
    assert.deepEqual(filter, {
      _id: 'company-id',
      type: 'dealer',
      isActive: true,
      isApproved: true,
    });
    return {
      select: () => ({
        lean: async () => ({ _id: 'company-id' }),
      }),
    };
  };
  assert.equal(await checkProfessionalAudience({ audienceTags: ['dealer'] }, {
    role: 'dealer',
    isEmailVerified: true,
    company: 'company-id',
  }), true);
});
