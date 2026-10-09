'use strict';

const { createHash } = require('node:crypto');
const { createError } = require('../middlewares/errorHandler');
const hubspot = require('../services/hubspot');
const HubSpotWebhookEvent = require('../models/HubSpotWebhookEvent');
const CrmConfig = require('../models/CrmConfig');
const Lead = require('../models/Lead');
const Quote = require('../models/Quote');
const Order = require('../models/Order');

function configuredValue(config, key, fallback) {
  return typeof config?.get === 'function' ? config.get(key) || fallback : config?.[key] || fallback;
}

async function processWebhookEvent(event) {
  const objectType = String(event.subscriptionType || '').split('.')[0];
  const propertyName = String(event.propertyName || '');
  const propertyValue = String(event.propertyValue ?? '');
  if (!['deal', 'contact'].includes(objectType) || !event.objectId) {
    return { ignored: true };
  }
  const stableId = event.eventId !== undefined
    ? String(event.eventId)
    : createHash('sha256').update(JSON.stringify([
      event.subscriptionType, event.objectId, propertyName, propertyValue,
      event.occurredAt, event.portalId,
    ])).digest('hex');
  const eventKey = `${event.portalId || 'portal'}:${stableId}`;
  try {
    await HubSpotWebhookEvent.create({
      eventKey,
      eventId: String(event.eventId || ''),
      objectType,
      objectId: String(event.objectId),
      propertyName,
      propertyValue,
    });
  } catch (error) {
    if (error.code === 11000) {return { duplicate: true };}
    throw error;
  }

  try {
    const config = await CrmConfig.findOne({ singletonKey: 'hubspot' }).lean();
    if (objectType === 'deal' && propertyName === 'dealstage') {
      const [quote, order] = await Promise.all([
        Quote.findOne({ hubspotDealId: String(event.objectId) }).select('_id').lean(),
        Order.findOne({ hubspotDealId: String(event.objectId) }).select('_id').lean(),
      ]);
      if (quote) {
        const mappedStatus = configuredValue(config?.quoteStageMap, propertyValue, '');
        if (mappedStatus) {await Quote.updateOne({ _id: quote._id }, { $set: { status: mappedStatus } });}
      }
      if (order) {
        const mappedStatus = configuredValue(config?.orderStageMap, propertyValue, '');
        if (mappedStatus) {await Order.updateOne({ _id: order._id }, { $set: { status: mappedStatus } });}
      }
    } else if (objectType === 'contact' &&
      propertyName === configuredValue(config?.contactProperties, 'leadStatus', 'lead_status')) {
      const mappedStatus = configuredValue(config?.leadStatusMap, propertyValue, '');
      if (mappedStatus) {
        const email = await hubspot.getContactEmail(event.objectId);
        if (email) {
          await Lead.updateMany({ email: email.toLowerCase() }, { $set: { status: mappedStatus } });
        }
      }
    }

    await HubSpotWebhookEvent.updateOne(
      { eventKey },
      { $set: { status: 'processed', processedAt: new Date() } },
    );
    return { processed: true };
  } catch (error) {
    await HubSpotWebhookEvent.deleteOne({ eventKey });
    throw error;
  }
}

async function handleHubSpotWebhook(req, res, next) {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const signature = req.get('X-HubSpot-Signature-v3');
    const timestamp = req.get('X-HubSpot-Request-Timestamp');
    const baseUrl = process.env.HUBSPOT_WEBHOOK_PUBLIC_URL;
    if (!baseUrl || !hubspot.verifyWebhookSignature(signature, {
      method: req.method,
      url: `${baseUrl.replace(/\/$/, '')}${req.originalUrl}`,
      body: rawBody,
      timestamp,
    })) {
      return next(createError(401, 'Invalid HubSpot webhook signature.'));
    }
    let events;
    try { events = JSON.parse(rawBody); } catch { return next(createError(400, 'Invalid HubSpot webhook payload.')); }
    if (!Array.isArray(events) || events.length > 100) {
      return next(createError(400, 'HubSpot webhook payload must contain at most 100 events.'));
    }
    const results = [];
    for (const event of events) {results.push(await processWebhookEvent(event));}
    res.status(200).json({ success: true, processed: results.filter((item) => item.processed).length });
  } catch (error) {
    next(error);
  }
}

module.exports = { handleHubSpotWebhook, processWebhookEvent };
