'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { persistBeforeNotify } = require('../../services/leadSubmission');

test('SES notification failure does not undo a persisted lead', async () => {
  const storedLead = { _id: 'lead-persisted-before-notification', email: 'customer@example.test' };
  let persisted = false;
  const originalError = console.error;
  console.error = () => {};
  try {
    const returned = await persistBeforeNotify(
      async () => {
        persisted = true;
        return storedLead;
      },
      async () => { throw new Error('SES unavailable'); },
    );
    assert.equal(persisted, true);
    assert.equal(returned, storedLead);
    assert.equal(returned._id, 'lead-persisted-before-notification');
  } finally {
    console.error = originalError;
  }
});

test('HubSpot queue failure leaves the source lead pending for backfill', async () => {
  const queuePath = require.resolve('../../queues');
  const leadPath = require.resolve('../../models/Lead');
  const hubspotPath = require.resolve('../../services/hubspot');
  const queues = require(queuePath);
  const Lead = require(leadPath);
  const originalGetQueue = queues.getQueue;
  const originalFindByIdAndUpdate = Lead.findByIdAndUpdate;
  const originalError = console.error;
  let pendingUpdate;

  queues.getQueue = () => ({
    add: async () => { throw new Error('Redis unavailable'); },
  });
  Lead.findByIdAndUpdate = async (id, update) => {
    pendingUpdate = { id, update };
    return { acknowledged: true };
  };
  delete require.cache[hubspotPath];
  const hubspot = require(hubspotPath);
  console.error = () => {};

  try {
    const result = await hubspot.enqueueSync('lead', 'persisted-lead-id');
    assert.deepEqual(result, { queued: false, error: 'Redis unavailable' });
    assert.equal(pendingUpdate.id, 'persisted-lead-id');
    assert.equal(pendingUpdate.update.$set.crmSyncStatus, 'pending');
  } finally {
    console.error = originalError;
    queues.getQueue = originalGetQueue;
    Lead.findByIdAndUpdate = originalFindByIdAndUpdate;
    delete require.cache[hubspotPath];
  }
});
