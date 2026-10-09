'use strict';

/**
 * HubSpot Adapter — Interface definition + env validation + health check
 *
 * SCOPE: CRM and Marketing Email.
 *   - Contacts, companies, deals, custom properties/schemas
 *   - Lead sync (from ALL forms and quotes via a single path)
 *   - Customer and order sync
 *   - Marketing email: newsletter, welcome, post-purchase marketing flow,
 *     abandoned-cart/quote recovery, campaigns
 *   - Two-way deal/contact status sync via webhooks
 *
 * NEVER use HubSpot for transactional / operational email (order confirmations,
 * password reset, status updates, lead notifications). Use the SES adapter.
 *
 * MODES use distinct private-app tokens and portal IDs. Live credentials are
 * never used as a fallback for sandbox (or vice versa).
 *
 * Usage (from Prompt 1.22 onwards):
 *   const hubspot = require('./hubspot');
 *   await hubspot.upsertContact({ email, firstName, lastName, ... });
 *   await hubspot.createDeal({ contactId, dealName, amount, ... });
 */

const { Client } = require('@hubspot/api-client');
const crypto = require('node:crypto');
const { getQueue } = require('../queues');

const CRM_MODE = () => (process.env.HUBSPOT_MODE || 'sandbox').toLowerCase();
const modeConfig = () => CRM_MODE() === 'live'
  ? { token: 'HUBSPOT_LIVE_PRIVATE_APP_TOKEN', portal: 'HUBSPOT_LIVE_PORTAL_ID' }
  : { token: 'HUBSPOT_SANDBOX_PRIVATE_APP_TOKEN', portal: 'HUBSPOT_SANDBOX_PORTAL_ID' };

// ─── Validate env ─────────────────────────────────────────────────────────────

/**
 * Throw an informative error if required HubSpot env vars are missing.
 * Called lazily (on first client creation) so the app starts even without
 * HubSpot configured in local dev.
 */
function validateConfig() {
  const mode = CRM_MODE();
  if (!['sandbox', 'live'].includes(mode)) {
    throw new Error(`HUBSPOT_MODE must be "sandbox" or "live", got "${mode}".`);
  }
  const config = modeConfig();
  const missing = [config.token, config.portal].filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`HubSpot ${mode} adapter: missing required env vars: ${missing.join(', ')}.`);
  }
}

function getPortalId() {
  validateConfig();
  return process.env[modeConfig().portal];
}

// ─── Client singleton ────────────────────────────────────────────────────────

let _client = null;

/**
 * Get (or lazily create) the @hubspot/api-client instance.
 * Uses the Private App token — never OAuth for server-to-server calls.
 *
 * @returns {import('@hubspot/api-client').Client}
 */
function getClient() {
  if (_client) {return _client;}

  validateConfig();

  _client = new Client({
    accessToken: process.env[modeConfig().token],
    limiterOptions: { maxConcurrent: 2, minTime: 125 },
    numberOfApiCallRetries: 3,
  });

  return _client;
}

// ─── Health check ─────────────────────────────────────────────────────────────

/**
 * Verify the private app token is valid and can reach the correct portal.
 * Returns { healthy: boolean, portalId: number|null, mode: string, error: string|null }.
 */
async function healthCheck() {
  try {
    validateConfig();
    const client = getClient();

    // The /account-info/v3/details endpoint requires no extra scopes.
    const res = await client.apiRequest({
      method: 'GET',
      path:   '/account-info/v3/details',
    });

    const body = await res.json();
    const expectedPortalId = Number(getPortalId());
    const actualPortalId   = body.portalId;

    if (actualPortalId !== expectedPortalId) {
      return {
        healthy:  false,
        portalId: actualPortalId,
        mode:     CRM_MODE(),
        error:    `Portal ID mismatch — expected ${expectedPortalId}, got ${actualPortalId}.`,
      };
    }

    return {
      healthy:  true,
      portalId: actualPortalId,
      mode:     CRM_MODE(),
      error:    null,
    };
  } catch (err) {
    return {
      healthy:  false,
      portalId: null,
      mode:     CRM_MODE(),
      error:    err.message,
    };
  }
}

// ─── CRM object operations ────────────────────────────────────────────────────

async function apiRequest(method, path, body) {
  const response = await getClient().apiRequest({ method, path, ...(body ? { body } : {}) });
  if (!response.ok) {
    const error = new Error(`HubSpot ${method} ${path} failed with status ${response.status}.`);
    error.status = response.status;
    if (response.status === 429) {
      const retryAfter = Number(response.headers?.get?.('Retry-After'));
      error.retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 10000;
    }
    throw error;
  }
  if (response.status === 204) {return {};}
  return response.json();
}

async function searchObject(objectType, propertyName, value) {
  const result = await apiRequest('POST', `/crm/v3/objects/${objectType}/search`, {
    filterGroups: [{ filters: [{ propertyName, operator: 'EQ', value: String(value) }] }],
    properties: [...new Set(objectType === 'contacts' ? [propertyName, 'email', 'phone'] : [propertyName])],
    limit: 2,
  });
  return result.results || [];
}

async function getContactEmail(contactId) {
  const result = await apiRequest(
    'GET',
    `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}?properties=email`,
  );
  return typeof result.properties?.email === 'string' ? result.properties.email : '';
}

function normalizedPhone(value = '') {
  const digits = String(value).replace(/\D/g, '');
  return digits.length >= 7 ? digits : '';
}

function configuredValue(config, key, fallback) {
  return typeof config?.get === 'function' ? config.get(key) || fallback : config?.[key] || fallback;
}

function contactProperties(data, configured = {}) {
  const props = {};
  const fields = {
    [configuredValue(configured, 'email', 'email')]: data.email,
    [configuredValue(configured, 'firstName', 'firstname')]: data.firstName,
    [configuredValue(configured, 'lastName', 'lastname')]: data.lastName,
    [configuredValue(configured, 'phone', 'phone')]: data.phone,
    [configuredValue(configured, 'company', 'company')]: data.company,
    [configuredValue(configured, 'leadSource', 'lead_source')]: data.leadSource || data.source,
    [configuredValue(configured, 'enquiryType', 'enquiry_type')]: data.enquiryType,
    [configuredValue(configured, 'productInterest', 'product_interest')]: data.productInterest,
    [configuredValue(configured, 'segment', 'segment')]: data.segment,
    [configuredValue(configured, 'pricingTier', 'pricing_tier')]: data.pricingTier,
    [configuredValue(configured, 'leadStatus', 'lead_status')]: data.leadStatus,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== '') {props[key] = String(value).slice(0, 500);}
  }
  const consentProperty = configuredValue(configured, 'marketingConsent', 'shadesology_marketing_consent');
  if (data.marketingConsent === true) {props[consentProperty] = 'true';}
  if (data.marketingConsent === false) {props[consentProperty] = 'false';}
  for (const [key, value] of Object.entries(data.customProperties || {})) {
    if (/^[a-z][a-z0-9_]{0,99}$/.test(key) && value !== undefined && value !== null) {
      props[key] = typeof value === 'string' ? value.slice(0, 1000) : String(value);
    }
  }
  return props;
}

/**
 * Upsert a HubSpot contact (match on email).
 * @param {object} contactData
 * @param {string} contactData.email
 * @param {string} [contactData.firstName]
 * @param {string} [contactData.lastName]
 * @param {string} [contactData.phone]
 * @param {string} [contactData.company]
 * @param {string} [contactData.lifecycleStage]
 * @param {object} [contactData.customProperties]
 * @returns {Promise<{ contactId: string }>}
 */
async function upsertContact(_contactData) {
  const data = _contactData || {};
  const email = String(data.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {throw new Error('HubSpot contact upsert requires a valid email address.');}
  const CrmConfig = require('../models/CrmConfig');
  const config = await CrmConfig.findOne({ singletonKey: 'hubspot' }).lean();
  const properties = contactProperties({ ...data, email }, config?.contactProperties || {});
  let existing = await searchObject('contacts', 'email', email);
  if (existing.length > 1) {
    throw new Error('HubSpot email dedupe found multiple matches; manual contact merge is required.');
  }
  const phoneKey = normalizedPhone(data.phone);
  if (!existing[0] && phoneKey) {
    const phoneMatches = await searchObject('contacts', 'phone', data.phone);
    const exactPhoneMatches = phoneMatches.filter((item) => normalizedPhone(item.properties?.phone) === phoneKey);
    if (exactPhoneMatches.length > 1) {
      throw new Error('HubSpot phone dedupe found multiple matches; manual contact merge is required.');
    }
    if (exactPhoneMatches[0]) {
      const matchedEmail = String(exactPhoneMatches[0].properties?.email || '').trim().toLowerCase();
      if (matchedEmail && matchedEmail !== email) {
        throw new Error('HubSpot phone dedupe found a different email; refusing to merge two distinct contacts.');
      }
      existing = exactPhoneMatches;
    }
  }
  if (existing[0]) {
    const result = await apiRequest('PATCH', `/crm/v3/objects/contacts/${encodeURIComponent(existing[0].id)}`, { properties });
    return { contactId: String(result.id) };
  }
  try {
    const result = await apiRequest('POST', '/crm/v3/objects/contacts', { properties });
    return { contactId: String(result.id) };
  } catch (err) {
    if (err.status !== 409) {throw err;}
    const contacts = await searchObject('contacts', 'email', email);
    if (!contacts[0] || contacts.length > 1) {throw err;}
    const result = await apiRequest('PATCH', `/crm/v3/objects/contacts/${encodeURIComponent(contacts[0].id)}`, { properties });
    return { contactId: String(result.id) };
  }
}

async function upsertCompany(data = {}) {
  const properties = {};
  for (const [key, value] of Object.entries({
    name: data.name,
    domain: data.domain,
    phone: data.phone,
    city: data.city,
    state: data.state,
    country: data.country,
    industry: data.industry,
  })) {
    if (value) {properties[key] = String(value).slice(0, 500);}
  }
  if (!properties.name) {throw new Error('HubSpot company upsert requires a company name.');}
  let matches = properties.domain ? await searchObject('companies', 'domain', properties.domain) : [];
  if (!matches.length) {matches = await searchObject('companies', 'name', properties.name);}
  if (matches[0]) {
    const result = await apiRequest('PATCH', `/crm/v3/objects/companies/${encodeURIComponent(matches[0].id)}`, { properties });
    return { companyId: String(result.id) };
  }
  try {
    const result = await apiRequest('POST', '/crm/v3/objects/companies', { properties });
    return { companyId: String(result.id) };
  } catch (err) {
    if (err.status !== 409) {throw err;}
    matches = properties.domain ? await searchObject('companies', 'domain', properties.domain) : [];
    if (!matches[0]) {throw err;}
    const result = await apiRequest('PATCH', `/crm/v3/objects/companies/${encodeURIComponent(matches[0].id)}`, { properties });
    return { companyId: String(result.id) };
  }
}

/**
 * Create or update a HubSpot deal.
 * @param {object} dealData
 * @param {string} dealData.contactId     HubSpot contact ID
 * @param {string} dealData.dealName
 * @param {number} dealData.amount
 * @param {string} dealData.stage         HubSpot pipeline stage ID
 * @param {string} [dealData.dealType]    e.g. 'quote' | 'order' | 'lead'
 * @param {object} [dealData.customProperties]
 * @returns {Promise<{ dealId: string }>}
 */
async function createDeal(_dealData) {
  const data = _dealData || {};
  const syncKey = String(data.syncKey || '').trim();
  if (!syncKey || !data.dealName || !Number.isFinite(Number(data.amount))) {
    throw new Error('HubSpot deal requires a stable syncKey, dealName, and finite amount.');
  }
  if (!data.pipeline || !data.stage) {throw new Error('HubSpot deal requires configured pipeline and stage IDs.');}
  const CrmConfig = require('../models/CrmConfig');
  const config = await CrmConfig.findOne({ singletonKey: 'hubspot' }).lean();
  const dealProperties = config?.dealProperties || {};
  const properties = {
    dealname: String(data.dealName).slice(0, 255),
    amount: String(Number(data.amount).toFixed(2)),
    pipeline: String(data.pipeline),
    dealstage: String(data.stage),
    [configuredValue(dealProperties, 'syncKey', 'shadesology_sync_key')]: syncKey.slice(0, 200),
    ...(data.dealType ? { [configuredValue(dealProperties, 'dealType', 'shadesology_deal_type')]: String(data.dealType) } : {}),
    ...(data.quoteRef ? { [configuredValue(dealProperties, 'quoteRef', 'shadesology_quote_ref')]: String(data.quoteRef) } : {}),
    ...(data.orderRef ? { [configuredValue(dealProperties, 'orderRef', 'shadesology_order_ref')]: String(data.orderRef) } : {}),
    ...(data.customProperties || {}),
  };
  const syncKeyProperty = configuredValue(dealProperties, 'syncKey', 'shadesology_sync_key');
  const matches = await searchObject('deals', syncKeyProperty, syncKey);
  const associations = [];
  if (data.contactId) {
    associations.push({ to: { id: String(data.contactId) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }], objectType: 'contacts' });
  }
  if (data.companyId) {
    associations.push({ to: { id: String(data.companyId) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }], objectType: 'companies' });
  }
  if (matches[0]) {
    const result = await apiRequest('PATCH', `/crm/v3/objects/deals/${encodeURIComponent(matches[0].id)}`, { properties });
    for (const association of associations) {
      await apiRequest('PUT', `/crm/v3/objects/deals/${encodeURIComponent(result.id)}/associations/${association.objectType}/${encodeURIComponent(association.to.id)}/${association.types[0].associationTypeId}`);
    }
    return { dealId: String(result.id) };
  }
  try {
    const result = await apiRequest('POST', '/crm/v3/objects/deals', {
      properties,
      ...(associations.length ? { associations } : {}),
    });
    return { dealId: String(result.id) };
  } catch (err) {
    if (err.status !== 409) {throw err;}
    const duplicate = await searchObject('deals', syncKeyProperty, syncKey);
    if (!duplicate[0]) {throw err;}
    const result = await apiRequest('PATCH', `/crm/v3/objects/deals/${encodeURIComponent(duplicate[0].id)}`, { properties });
    for (const association of associations) {
      await apiRequest('PUT', `/crm/v3/objects/deals/${encodeURIComponent(result.id)}/associations/${association.objectType}/${encodeURIComponent(association.to.id)}/${association.types[0].associationTypeId}`);
    }
    return { dealId: String(result.id) };
  }
}

async function syncMarketingSubscription(email, status, consentVersion) {
  const subscriptionId = process.env.HUBSPOT_MARKETING_SUBSCRIPTION_ID;
  if (!subscriptionId) {throw new Error('HUBSPOT_MARKETING_SUBSCRIPTION_ID is required to sync newsletter subscription status.');}
  if (!Number.isSafeInteger(Number(subscriptionId)) || Number(subscriptionId) <= 0) {
    throw new Error('HUBSPOT_MARKETING_SUBSCRIPTION_ID must be a positive integer.');
  }
  if (!['SUBSCRIBED', 'UNSUBSCRIBED'].includes(status)) {throw new Error('Invalid HubSpot marketing subscription status.');}
  return apiRequest(
    'POST',
    `/communication-preferences/v4/statuses/${encodeURIComponent(email)}`,
    {
      subscriptionId: Number(subscriptionId),
      statusState: status,
      channel: 'EMAIL',
      legalBasis: status === 'SUBSCRIBED' ? 'CONSENT_WITH_NOTICE' : 'PROCESS_AND_STORE',
      legalBasisExplanation: status === 'SUBSCRIBED'
        ? `Recorded double opt-in; consent version ${String(consentVersion || '').slice(0, 100)}`
        : 'Recorded unsubscribe request.',
    },
  );
}

/**
 * Enqueue a contact/lead for CRM sync.
 * Items are picked up by the BullMQ CRM sync worker (Prompt 1.22).
 * Storing the record in DB and calling this enqueue is the correct pattern:
 *   1. Store in DB (done by caller)
 *   2. enqueueSync() → adds to BullMQ queue
 *   3. Worker calls upsertContact / createDeal with retry
 *
 * @param {'lead'|'application'|'newsletter'|'cart'|'order'|'quote'} entityType
 * @param {string}                           entityId    MongoDB ObjectId
 * @param {object}                           [options]
 */
async function enqueueSync(entityType, entityId, options = {}) {
  const supported = new Set(['lead', 'application', 'newsletter', 'cart', 'order', 'quote']);
  if (!supported.has(entityType) || !entityId) {
    throw new Error(`Unsupported HubSpot sync request: ${entityType || '(missing type)'}.`);
  }
  const modelNames = {
    lead: 'Lead', application: 'ApprovalRequest', newsletter: 'NewsletterSubscriber',
    cart: 'Cart', order: 'Order', quote: 'Quote',
  };
  const Model = require(`../models/${modelNames[entityType]}`);
  await Model.findByIdAndUpdate(entityId, {
    $set: { crmSyncStatus: 'pending', crmLastError: '' },
  }).catch((error) => {
    console.error('[HubSpot] Could not persist pending sync status.', {
      entityType, entityId: String(entityId), error: error.message,
    });
  });
  try {
    const queue = getQueue('crm-sync');
    const job = await queue.add('sync', { entityType, entityId: String(entityId) }, {
      jobId: `crm-${entityType}-${entityId}-${Date.now()}`,
      attempts: 8,
      backoff: { type: 'hubspot', delay: 2000 },
      ...(Number.isFinite(options.delay) && options.delay > 0 ? { delay: options.delay } : {}),
    });
    if (job.id === 'noop') {
      console.warn('[HubSpot] CRM queue is disabled; record remains pending for backfill.', { entityType, entityId: String(entityId) });
      return { queued: false };
    }
    return { queued: true, jobId: job.id };
  } catch (err) {
    console.error('[HubSpot] CRM enqueue failed; record remains pending for backfill.', {
      entityType, entityId: String(entityId), error: err.message,
    });
    return { queued: false, error: err.message };
  }
}

/**
 * Find a contact by email and apply HubSpot's GDPR delete operation.
 * A missing contact is treated as already deleted so retries are idempotent.
 */
async function deleteContactByEmail(email, client = getClient()) {
  const searchResponse = await client.apiRequest({
    method: 'POST',
    path: '/crm/v3/objects/contacts/search',
    body: {
      filterGroups: [{
        filters: [{ propertyName: 'email', operator: 'EQ', value: email }],
      }],
      properties: ['email'],
      limit: 10,
    },
  });
  const search = await searchResponse.json();

  for (const contact of search.results || []) {
    const path = `/crm/v3/objects/contacts/${encodeURIComponent(contact.id)}/gdpr-delete?portalId=${encodeURIComponent(getPortalId())}`;
    const response = await client.apiRequest({ method: 'POST', path });
    if (!response.ok && response.status !== 404) {
      throw new Error(`HubSpot GDPR delete failed with status ${response.status}.`);
    }
  }

  return { deleted: (search.results || []).length };
}

/**
 * Verify HubSpot's v3 webhook signature using the raw body and request URL.
 * @returns {boolean}
 */
function verifyWebhookSignature(signature, request) {
  if (!process.env.HUBSPOT_WEBHOOK_SECRET || typeof signature !== 'string' || !request ||
    typeof request.body !== 'string' || typeof request.method !== 'string' ||
    typeof request.url !== 'string' || typeof request.timestamp !== 'string') {return false;}
  const timestamp = Number(request.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {return false;}
  const uri = request.url.split('#')[0];
  const queryStart = uri.indexOf('?');
  const decodeMap = {
    '%3A': ':', '%2F': '/', '%3F': '?', '%40': '@', '%21': '!',
    '%24': '$', '%27': "'", '%28': '(', '%29': ')', '%2A': '*',
    '%2C': ',', '%3B': ';',
  };
  const signedUri = queryStart < 0
    ? uri
    : `${uri.slice(0, queryStart + 1)}${uri.slice(queryStart + 1).replace(
      /%3A|%2F|%3F|%40|%21|%24|%27|%28|%29|%2A|%2C|%3B/gi,
      (match) => decodeMap[match.toUpperCase()],
    )}`;
  const source = `${request.method.toUpperCase()}${signedUri}${request.body}${request.timestamp}`;
  const expected = crypto.createHmac('sha256', process.env.HUBSPOT_WEBHOOK_SECRET)
    .update(source)
    .digest('base64');
  const suppliedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  getClient,
  healthCheck,
  upsertContact,
  upsertCompany,
  createDeal,
  syncMarketingSubscription,
  apiRequest,
  getContactEmail,
  enqueueSync,
  deleteContactByEmail,
  verifyWebhookSignature,
  validateConfig,
};
