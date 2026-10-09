'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOrderForResponse } = require('../../services/orderFormatting');

describe('Order response formatting', () => {
  it('serializes configured options stored in Maps for customer and production views', () => {
    const result = normalizeOrderForResponse({
      orderNumber: 'SH-2026-00001',
      items: [{ selectedOptions: new Map([['Fabric', 'Ivory'], ['Motor', 'Somfy']]) }],
    });
    assert.deepEqual(result.items[0].selectedOptions, { Fabric: 'Ivory', Motor: 'Somfy' });
  });
});
