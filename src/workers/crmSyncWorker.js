'use strict';

const { Worker } = require('bullmq');
const { createRedisConnection, isRedisEnabled } = require('../config/redis');
const { getQueue } = require('../queues');
const hubspot = require('../services/hubspot');
const Lead = require('../models/Lead');
const Quote = require('../models/Quote');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const ApprovalRequest = require('../models/ApprovalRequest');
const NewsletterSubscriber = require('../models/NewsletterSubscriber');
const Company = require('../models/Company');

const models = {
  lead: Lead,
  quote: Quote,
  order: Order,
  cart: Cart,
  application: ApprovalRequest,
  newsletter: NewsletterSubscriber,
};

function splitName(value = '') {
  const parts = String(value).trim().split(/\s+/);
  return { firstName: parts.shift() || '', lastName: parts.join(' ') };
}

function companyFrom(user, fallbackName = '') {
  const company = user?.company;
  if (!company && !fallbackName) {return null;}
  const website = company?.website || '';
  let domain = '';
  try { domain = new URL(website.startsWith('http') ? website : `https://${website}`).hostname.replace(/^www\./, ''); } catch (error) { domain = ''; }
  return {
    id: company?._id,
    name: company?.name || fallbackName,
    domain,
    phone: company?.phone || '',
    city: company?.address?.city || '',
    state: company?.address?.state || '',
    country: company?.address?.country || '',
    industry: company?.industry || '',
  };
}

async function getEntity(entityType, entityId) {
  if (entityType === 'quote') {
    return Quote.findById(entityId).populate({ path: 'user', populate: { path: 'company' } }).lean();
  }
  if (entityType === 'order') {
    return Order.findById(entityId).populate({ path: 'user', populate: { path: 'company' } }).lean();
  }
  if (entityType === 'application') {
    return ApprovalRequest.findById(entityId).populate({ path: 'applicant', populate: { path: 'company' } }).lean();
  }
  if (entityType === 'cart') {
    return Cart.findById(entityId).populate({ path: 'user', populate: { path: 'company' } }).lean();
  }
  return models[entityType].findById(entityId).lean();
}

function dealPipeline(dealType) {
  const prefix = dealType === 'quote' ? 'HUBSPOT_QUOTES' : 'HUBSPOT_ORDERS';
  const pipeline = process.env[`${prefix}_PIPELINE_ID`];
  const stage = process.env[`${prefix}_STAGE_ID`];
  if (!pipeline || !stage) {throw new Error(`${prefix}_PIPELINE_ID and ${prefix}_STAGE_ID are required for ${dealType} sync.`);}
  return { pipeline, stage };
}

async function markSync(entityType, entityId, values) {
  const Model = models[entityType];
  await Model.updateOne({ _id: entityId }, { $set: values });
}

async function syncCompany(companyData, contactId, dealId) {
  if (!companyData?.name) {return null;}
  let companyId = '';
  if (companyData.id) {
    const localCompany = await Company.findById(companyData.id).select('hubspotCompanyId').lean();
    companyId = localCompany?.hubspotCompanyId || '';
  }
  if (!companyId) {
    ({ companyId } = await hubspot.upsertCompany(companyData));
    if (companyData.id) {
      await Company.updateOne({ _id: companyData.id }, { $set: { hubspotCompanyId: companyId } });
    }
  }
  if (contactId) {
    await hubspot.apiRequest('PUT', `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}/associations/companies/${encodeURIComponent(companyId)}/1`);
  }
  if (dealId) {
    await hubspot.apiRequest('PUT', `/crm/v3/objects/deals/${encodeURIComponent(dealId)}/associations/companies/${encodeURIComponent(companyId)}/5`);
  }
  return companyId;
}

async function syncMarketingSubscription(subscriber) {
  if (subscriber.status === 'confirmed' &&
    !(subscriber.consentGiven && subscriber.consentAt && subscriber.consentVersion && subscriber.confirmedAt)) {
    throw new Error('Newsletter opt-in cannot be synced without recorded, confirmed consent.');
  }
  const status = subscriber.status === 'confirmed' ? 'SUBSCRIBED' : 'UNSUBSCRIBED';
  await hubspot.syncMarketingSubscription(subscriber.email, status, subscriber.consentVersion);
}

async function syncEntity(entityType, entityId) {
  const record = await getEntity(entityType, entityId);
  if (!record) {throw new Error(`CRM source ${entityType} ${entityId} no longer exists.`);}

  if (entityType === 'cart' && (!record.contactEmail || !record.checkoutStartedAt || !record.items?.length)) {
    await markSync(entityType, entityId, { crmSyncStatus: 'skipped', crmLastError: '' });
    return { skipped: true, reason: 'Cart is no longer an abandoned checkout.' };
  }
  if (entityType === 'newsletter') {
    if (!['pending', 'confirmed', 'unsubscribed'].includes(record.status)) {
      await markSync(entityType, entityId, { crmSyncStatus: 'skipped', crmLastError: '' });
      return { skipped: true, reason: 'Newsletter state is not syncable.' };
    }
    const { firstName, lastName } = splitName(record.name || '');
    const { contactId } = await hubspot.upsertContact({
      email: record.email,
      firstName,
      lastName,
      source: record.source,
      marketingConsent: record.status === 'confirmed' && record.consentGiven === true &&
        Boolean(record.consentAt && record.consentVersion && record.confirmedAt),
      customProperties: { newsletter_interests: (record.interests || []).join(',').slice(0, 1000) },
    });
    await markSync(entityType, entityId, { hubspotContactId: contactId });
    if (record.status !== 'pending') {await syncMarketingSubscription(record);}
    await markSync(entityType, entityId, {
      crmSyncStatus: 'synced',
      crmLastSyncedAt: new Date(),
      crmLastError: '',
    });
    return { contactId };
  }

  let contact = {};
  let companyData = null;
  let dealData = null;
  if (entityType === 'lead') {
    const names = splitName(record.name);
    const isCommercialLead = record.leadQueue === 'commercial';
    contact = {
      email: record.email,
      ...names,
      phone: record.phone,
      company: record.company,
      enquiryType: record.enquiryType,
      productInterest: record.productType,
      source: record.source,
      leadStatus: record.status,
      customProperties: isCommercialLead
        ? { shadesology_commercial_flag: 'true', shadesology_lead_queue: 'commercial' }
        : undefined,
    };
    companyData = companyFrom(null, record.company);
    if (isCommercialLead) {
      const pipeline = process.env.HUBSPOT_COMMERCIAL_PIPELINE_ID;
      const stage = process.env.HUBSPOT_COMMERCIAL_STAGE_ID;
      if (!pipeline || !stage) {
        throw new Error('HUBSPOT_COMMERCIAL_PIPELINE_ID and HUBSPOT_COMMERCIAL_STAGE_ID are required for commercial lead sync.');
      }
      dealData = {
        syncKey: `commercial-lead:${record._id}`,
        dealName: `Commercial project — ${record.company || record.name}`,
        amount: 0,
        dealType: 'commercial_lead',
        pipeline,
        stage,
        customProperties: { shadesology_commercial_flag: 'true' },
      };
    }
  } else if (entityType === 'quote') {
    const guest = record.guestContact || {};
    const names = record.user
      ? { firstName: record.user.firstName, lastName: record.user.lastName }
      : { firstName: guest.firstName, lastName: guest.lastName };
    const email = record.user?.email || guest.email;
    contact = {
      email,
      ...names,
      phone: record.user?.phone || guest.phone,
      pricingTier: record.user?.pricingGroup,
      company: record.user?.company?.name || guest.company,
      enquiryType: 'quote',
      productInterest: (record.items || []).map((item) => item.productName).filter(Boolean).join(', '),
      segment: record.buildingType,
      source: 'quote',
    };
    companyData = companyFrom(record.user, guest.company);
    const { pipeline, stage } = dealPipeline('quote');
    dealData = {
      syncKey: `quote:${record._id}`,
      dealName: `Quote ${record.referenceNumber}`,
      amount: Number(record.total || record.subtotal || 0) / 100,
      dealType: 'quote',
      pipeline,
      stage,
      quoteRef: record.referenceNumber || '',
    };
  } else if (entityType === 'order') {
    const names = splitName(record.guestName || [
      record.shippingAddress?.firstName,
      record.shippingAddress?.lastName,
    ].filter(Boolean).join(' '));
    contact = {
      email: record.user?.email || record.guestEmail,
      firstName: record.user?.firstName || names.firstName,
      lastName: record.user?.lastName || names.lastName,
      phone: record.user?.phone || record.shippingAddress?.phone,
      pricingTier: record.user?.pricingGroup,
      company: record.user?.company?.name || record.shippingAddress?.company,
      enquiryType: 'order',
      productInterest: (record.items || []).map((item) => item.productName).filter(Boolean).join(', '),
      source: record.source,
    };
    companyData = companyFrom(record.user, record.shippingAddress?.company);
    const { pipeline, stage } = dealPipeline('order');
    dealData = {
      syncKey: `order:${record._id}`,
      dealName: `Order ${record.orderNumber}`,
      amount: Number(record.total || 0),
      dealType: 'order',
      pipeline,
      stage,
      orderRef: record.orderNumber || '',
    };
  } else if (entityType === 'cart') {
    const names = splitName(record.contactName || `${record.user?.firstName || ''} ${record.user?.lastName || ''}`);
    contact = {
      email: record.contactEmail,
      firstName: record.user?.firstName || names.firstName,
      lastName: record.user?.lastName || names.lastName,
      phone: record.user?.phone,
      company: record.user?.company?.name,
      source: 'abandoned_cart',
      customProperties: { shadesology_abandoned_cart_item_count: String(record.items.length) },
    };
    companyData = companyFrom(record.user);
  } else if (entityType === 'application') {
    const applicant = record.applicant || {};
    if (!['installer_application', 'dealer_application', 'specifier_application', 'trade_application'].includes(record.type)) {
      await markSync(entityType, entityId, { crmSyncStatus: 'skipped', crmLastError: '' });
      return { skipped: true, reason: 'Application type is not a CRM lead.' };
    }
    contact = {
      email: applicant.email,
      firstName: applicant.firstName,
      lastName: applicant.lastName,
      phone: applicant.phone,
      company: record.data?.businessName || record.data?.companyName || applicant.company?.name,
      enquiryType: record.type,
      pricingTier: applicant.pricingGroup,
      productInterest: Array.isArray(record.data?.specialities)
        ? record.data.specialities.join(', ')
        : record.data?.productsOfInterest,
      source: 'application',
    };
    companyData = companyFrom(applicant, contact.company);
  }

  if (!contact.email) {throw new Error(`CRM source ${entityType} is missing a contact email.`);}
  const { contactId } = await hubspot.upsertContact(contact);
  const updates = { hubspotContactId: contactId };
  if (entityType === 'quote' || entityType === 'order' || (entityType === 'lead' && dealData)) {
    const companyId = await syncCompany(companyData, contactId);
    const { dealId } = await hubspot.createDeal({ ...dealData, contactId, companyId });
    updates.hubspotDealId = dealId;
    if (entityType === 'quote' || entityType === 'order') {updates.crmDealId = dealId;}
  } else if (companyData?.name) {
    const companyId = await syncCompany(companyData, contactId);
    if (entityType === 'application') {updates.hubspotCompanyId = companyId;}
  }
  updates.crmSyncStatus = 'synced';
  updates.crmLastSyncedAt = new Date();
  updates.crmLastError = '';
  await markSync(entityType, entityId, updates);
  return { contactId, dealId: updates.hubspotDealId || null };
}

async function notifyFailure(job, error) {
  if (!job) {return;}
  const { entityType, entityId } = job.data || {};
  if (models[entityType]) {
    await markSync(entityType, entityId, {
      crmSyncStatus: 'failed',
      crmLastError: String(error?.message || 'CRM sync failed').slice(0, 1000),
    }).catch((markErr) => console.error('[CRM] Could not persist failed sync state:', markErr.message));
  }
  try {
    await getQueue('crm-dead-letter').add('failed-sync', {
      entityType,
      entityId,
      jobId: job.id,
      error: String(error?.message || 'CRM sync failed').slice(0, 1000),
      failedAt: new Date().toISOString(),
    }, { jobId: `crm-dead-letter-${job.id}` });
  } catch (queueErr) {
    console.error('[CRM] Could not enqueue dead-letter record:', queueErr.message);
  }
  if (process.env.CRM_ALERT_EMAIL) {
    try {
      await getQueue('email').add('send', {
        to: process.env.CRM_ALERT_EMAIL,
        subject: 'HubSpot CRM sync exhausted retries',
        text: `CRM sync ${entityType}:${entityId} exhausted retries. Error: ${String(error?.message || 'unknown').slice(0, 500)}`,
      }, { jobId: `crm-alert-${job.id}` });
    } catch (queueErr) {
      console.error('[CRM] Could not enqueue sync failure alert:', queueErr.message);
    }
  }
}

let worker = null;

function start() {
  if (worker || !isRedisEnabled()) {return;}
  const connection = createRedisConnection();
  if (!connection) {return;}
  worker = new Worker('crm-sync', async (job) => {
    if (job.name !== 'sync') {throw new Error(`Unsupported CRM job: ${job.name}`);}
    return syncEntity(job.data.entityType, job.data.entityId);
  }, {
    connection,
    concurrency: 4,
    limiter: { max: 1, duration: 2000 },
    settings: {
      backoffStrategy: (attemptsMade, type, error) => {
        if (type !== 'hubspot') {return -1;}
        if (Number.isFinite(error?.retryAfterMs) && error.retryAfterMs > 0) {
          return Math.min(error.retryAfterMs, 5 * 60 * 1000);
        }
        return Math.min(2000 * (2 ** Math.max(0, attemptsMade - 1)), 5 * 60 * 1000);
      },
    },
  });
  worker.on('failed', (job, error) => {
    if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
      notifyFailure(job, error).catch((err) => console.error('[CRM] Failure handler error:', err.message));
    }
  });
  worker.on('error', (error) => console.error('[CRM] Worker error:', error.message));
  console.info('[CRM] HubSpot sync worker started.');
}

async function stop() {
  if (!worker) {return;}
  await worker.close();
  worker = null;
}

module.exports = { start, stop, syncEntity };
