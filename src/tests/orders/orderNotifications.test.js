'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, optionText, orderItemsHtml, orderItemsText } = require('../../services/orderNotifications');

describe('Order communication formatting', () => {
  it('escapes HTML in customer-provided values', () => {
    assert.equal(escapeHtml(`<shade & "screen">`), '&lt;shade &amp; &quot;screen&quot;&gt;');
  });

  it('formats nested and Mongoose-map-like configuration values', () => {
    assert.equal(optionText({ value: ['White', 'RAL 9003'] }), 'White, RAL 9003');
    const html = orderItemsHtml({
      items: [{
        productName: 'Pergola',
        variantName: '4 × 3',
        sku: 'P-1',
        quantity: 2,
        lineTotal: 1200,
        selectedOptions: new Map([['Frame', '<White>']]),
        surcharges: [{ label: 'Motor', amount: 150 }],
      }],
    });
    assert.match(html, /Frame:<\/strong> &lt;White&gt;/);
    assert.match(html, /Motor: 150\.00/);
    assert.match(html, /× 2 — 1200\.00/);
    const text = orderItemsText({
      items: [{
        productName: 'Pergola',
        variantName: '4 × 3',
        sku: 'P-1',
        quantity: 2,
        lineTotal: 1200,
        selectedOptions: new Map([['Frame', 'White']]),
      }],
    });
    assert.match(text, /Frame: White/);
  });
});
