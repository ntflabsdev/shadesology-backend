'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Company = require('../../models/Company');
const AuditLog = require('../../models/AuditLog');
const { resolvePricingUser } = require('../../services/commercialPricing');

const originalFindOne = Company.findOne;
const originalRecord = AuditLog.record;

after(() => {
  Company.findOne = originalFindOne;
  AuditLog.record = originalRecord;
});

test('unverified dealer accounts receive no commercial pricing identity', async () => {
  Company.findOne = () => {
    throw new Error('An unverified account must not query commercial pricing.');
  };
  const user = await resolvePricingUser({
    _id: 'user-id',
    role: 'dealer',
    isEmailVerified: false,
    pricingGroup: 'dealer-tier',
  });
  assert.equal(user.role, 'customer');
  assert.equal(user.pricingGroup, '');
});

test('approved dealer pricing inherits the company tier and excludes inactive companies', async () => {
  const auditEvents = [];
  Company.findOne = () => ({
    select: () => ({
      lean: async () => ({ _id: 'company-id', pricingGroup: 'company-tier' }),
    }),
  });
  AuditLog.record = async (event) => auditEvents.push(event);

  const dealer = await resolvePricingUser({
    _id: 'user-id',
    email: 'dealer@example.com',
    role: 'dealer',
    isEmailVerified: true,
    company: 'company-id',
    pricingGroup: '',
  });
  assert.equal(dealer.role, 'dealer');
  assert.equal(dealer.pricingGroup, 'company-tier');
  assert.equal(auditEvents[0].meta.pricingGroup, 'company-tier');

  Company.findOne = () => ({
    select: () => ({
      lean: async () => null,
    }),
  });
  const inactive = await resolvePricingUser({
    _id: 'user-id',
    email: 'dealer@example.com',
    role: 'dealer',
    isEmailVerified: true,
    company: 'company-id',
    pricingGroup: 'dealer-tier',
  });
  assert.equal(inactive.role, 'customer');
  assert.equal(inactive.pricingGroup, '');
});
