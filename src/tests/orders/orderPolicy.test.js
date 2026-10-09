'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateCustomerRequest } = require('../../services/orderPolicy');

describe('Customer order request policy', () => {
  it('accepts cancellation requests before production for made-to-order purchases', () => {
    const result = evaluateCustomerRequest({
      status: 'confirmed',
      items: [{ availability: 'made_to_order' }],
    }, 'cancellation');
    assert.equal(result.allowed, true);
    assert.deepEqual(result.availability, ['made_to_order']);
  });

  it('blocks cancellation once production begins', () => {
    const result = evaluateCustomerRequest({
      status: 'in_production',
      items: [{ availability: 'made_to_order' }],
    }, 'cancellation');
    assert.equal(result.allowed, false);
  });

  it('allows returns only after delivery and flags made-to-order eligibility for staff review', () => {
    const result = evaluateCustomerRequest({
      status: 'delivered',
      items: [{ availability: 'in_stock' }, { availability: 'made_to_order' }],
    }, 'return');
    assert.equal(result.allowed, true);
    assert.match(result.policyNotice, /reviewed case by case/);
    assert.deepEqual(result.availability, ['in_stock', 'made_to_order']);
  });

  it('rejects invalid request types and premature returns', () => {
    assert.equal(evaluateCustomerRequest({ status: 'delivered', items: [] }, 'refund').allowed, false);
    assert.equal(evaluateCustomerRequest({ status: 'shipped', items: [] }, 'return').allowed, false);
  });
});
