'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const CrmBackfillRun = require('../models/CrmBackfillRun');
const { getQueue } = require('../queues');
const Lead = require('../models/Lead');
const Quote = require('../models/Quote');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const ApprovalRequest = require('../models/ApprovalRequest');
const NewsletterSubscriber = require('../models/NewsletterSubscriber');

const entities = {
  lead: Lead,
  quote: Quote,
  order: Order,
  cart: Cart,
  application: ApprovalRequest,
  newsletter: NewsletterSubscriber,
};
const args = new Set(process.argv.slice(2));
const entityArg = process.argv.find((arg) => arg.startsWith('--entity='))?.slice(9);
const batchArg = Number(process.argv.find((arg) => arg.startsWith('--batch-size='))?.slice(13) || 100);
const dryRun = args.has('--dry-run');
const reset = args.has('--reset');
let crmQueue = null;

async function main() {
  if (entityArg && !entities[entityArg]) {
    throw new Error(`Unknown entity "${entityArg}". Choose: ${Object.keys(entities).join(', ')}`);
  }
  if (!Number.isInteger(batchArg) || batchArg < 1 || batchArg > 1000) {
    throw new Error('--batch-size must be between 1 and 1000.');
  }
  await connectDB();
  const queue = crmQueue = getQueue('crm-sync');
  for (const [entityType, Model] of Object.entries(entities)) {
    if (entityArg && entityArg !== entityType) {continue;}
    const runKey = `${process.env.HUBSPOT_MODE || 'sandbox'}:${entityType}`;
    if (reset && !dryRun) {await CrmBackfillRun.deleteOne({ key: runKey });}
    const run = dryRun ? null : await CrmBackfillRun.findOneAndUpdate(
      { key: runKey },
      { $setOnInsert: { key: runKey } },
      { upsert: true, new: true },
    );
    let lastId = run?.lastId || null;
    let processed = 0;
    let hasMore = true;
    while (hasMore) {
      const filter = lastId ? { _id: { $gt: lastId } } : {};
      const records = await Model.find(filter).select('_id').sort({ _id: 1 }).limit(batchArg).lean();
      if (!records.length) {
        hasMore = false;
        continue;
      }
      for (const record of records) {
        if (dryRun) {
          console.info(`[dry-run] ${entityType} ${record._id}`);
        } else {
          await Model.updateOne({ _id: record._id }, { $set: { crmSyncStatus: 'pending', crmLastError: '' } });
          const job = await queue.add('sync', { entityType, entityId: String(record._id) }, {
            jobId: `crm-backfill-${entityType}-${record._id}-${Date.now()}`,
            attempts: 8,
            backoff: { type: 'hubspot', delay: 2000 },
          });
          if (job.id === 'noop') {throw new Error('CRM queue is disabled; set REDIS_ENABLED=true before backfill.');}
          lastId = record._id;
          run.lastId = lastId;
          await run.save();
        }
        processed += 1;
      }
      if (dryRun) {lastId = records[records.length - 1]._id;}
    }
    if (!dryRun && run) {
      run.completedAt = new Date();
      await run.save();
    }
    console.info(`[HubSpot backfill] ${entityType}: ${processed} ${dryRun ? 'would be queued' : 'queued'}.`);
  }
}

main()
  .catch((error) => {
    console.error('[HubSpot backfill] Failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (crmQueue) {await crmQueue.close().catch(() => {});}
    await mongoose.disconnect().catch(() => {});
  });
