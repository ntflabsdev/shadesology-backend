'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Lead = require('../../models/Lead');

test('commercial project leads are always classified into the commercial queue', async () => {
  const lead = new Lead({
    enquiryType: 'commercial_project',
    name: 'Project Contact',
    email: 'contact@example.test',
    message: 'Please help us scope this project.',
  });

  await lead.validate();
  assert.equal(lead.leadQueue, 'commercial');
  assert.equal(lead.commercialFlag, true);
});

test('ordinary contact leads remain in the consumer queue', async () => {
  const lead = new Lead({
    enquiryType: 'contact',
    name: 'Retail Customer',
    email: 'customer@example.test',
    message: 'I have a question about a product.',
  });

  await lead.validate();
  assert.equal(lead.leadQueue, 'consumer');
  assert.equal(lead.commercialFlag, false);
});
