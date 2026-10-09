'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitiseProductManuals } = require('../../controllers/catalog/productController');

test('public product payloads do not expose file URLs for gated manuals', () => {
  const manuals = sanitiseProductManuals([
    { title: 'Public manual', gating: 'open', fileUrl: 'https://cdn.example/manual.pdf' },
    { title: 'Dealer guide', gating: 'role_required', fileUrl: 'private/dealer-guide.pdf' },
  ]);

  assert.equal(manuals[0].fileUrl, 'https://cdn.example/manual.pdf');
  assert.equal(manuals[1].fileUrl, null);
});
