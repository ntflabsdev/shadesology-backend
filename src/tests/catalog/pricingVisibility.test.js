'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitiseVariantForUser,
  auditResponseForDealerPriceLeaks,
} = require('@shadesology/pricing');

test('retail API payloads contain no dealer tiers or wholesale base price', () => {
  const response = {
    variant: sanitiseVariantForUser({
      sku: 'SHADE-1',
      basePrice: 1000,
      priceTiers: [{ tierKey: 'dealer', price: 600 }],
    }, { role: 'customer', pricingGroup: '' }),
  };

  assert.deepEqual(auditResponseForDealerPriceLeaks(response), { clean: true, leaks: [] });
  assert.equal(response.variant.displayPrice, 1000);
  assert.equal('basePrice' in response.variant, false);
});

test('retail users without an approved pricing group remain on retail pricing', () => {
  const response = {
    variant: sanitiseVariantForUser({
      basePrice: 1000,
      priceTiers: [{ tierKey: 'dealer', price: 600 }],
    }, { role: 'dealer', pricingGroup: '' }),
  };

  assert.equal(response.variant.displayPrice, 1000);
  assert.equal(response.variant.priceType, 'retail');
  assert.deepEqual(auditResponseForDealerPriceLeaks(response), { clean: true, leaks: [] });
});
