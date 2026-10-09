'use strict';

const { createError } = require('../../middlewares/errorHandler');
const { getQueue } = require('../../queues');
const Lead = require('../../models/Lead');
const Quote = require('../../models/Quote');
const Order = require('../../models/Order');
const Cart = require('../../models/Cart');
const ApprovalRequest = require('../../models/ApprovalRequest');
const NewsletterSubscriber = require('../../models/NewsletterSubscriber');
const CrmConfig = require('../../models/CrmConfig');
const hubspot = require('../../services/hubspot');

const MODELS = [Lead, Quote, Order, Cart, ApprovalRequest, NewsletterSubscriber];
const CONTACT_KEYS = [
  'email', 'firstName', 'lastName', 'phone', 'company', 'leadSource',
  'enquiryType', 'productInterest', 'segment', 'pricingTier', 'marketingConsent',
  'leadStatus',
];
const DEAL_KEYS = ['syncKey', 'dealType', 'quoteRef', 'orderRef'];
const QUOTE_STATES = ['draft', 'submitted', 'in_review', 'quoted', 'accepted', 'ordered', 'declined', 'expired'];
const ORDER_STATES = ['pending', 'payment_processing', 'confirmed', 'in_production', 'ready_to_ship', 'shipped', 'delivered', 'cancelled', 'refunded'];
const LEAD_STATES = ['new', 'assigned', 'contacted', 'closed'];

async function crmDashboard(req, res, next) {
  try {
    const statuses = ['pending', 'synced', 'failed', 'skipped'];
    const entities = await Promise.all(MODELS.map(async (Model) => ({
      entity: Model.modelName,
      ...(await Object.fromEntries(await Promise.all(statuses.map(async (status) => [
        status,
        await Model.countDocuments({ crmSyncStatus: status }),
      ])))),
    })));
    const deadLetterCounts = await getQueue('crm-dead-letter').getJobCounts('waiting', 'failed', 'delayed');
    const failedRecords = await Promise.all(MODELS.map((Model) =>
      Model.find({ crmSyncStatus: 'failed' })
        .select('_id crmLastError updatedAt')
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean()
        .then((records) => records.map((record) => ({
          entity: Model.modelName,
          id: String(record._id),
          error: record.crmLastError,
          updatedAt: record.updatedAt,
        }))),
    ));
    res.json({
      success: true,
      data: {
        mode: process.env.HUBSPOT_MODE || 'sandbox',
        entities,
        deadLetterCounts,
        recentFailures: failedRecords.flat().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 20),
      },
    });
  } catch (error) {next(error);}
}

async function getCrmConfig(req, res, next) {
  try {
    const config = await CrmConfig.findOne({ singletonKey: 'hubspot' }).lean();
    res.json({ success: true, data: config || {} });
  } catch (error) {next(error);}
}

async function updateCrmConfig(req, res, next) {
  try {
    const { contactProperties, dealProperties, quoteStageMap, orderStageMap, leadStatusMap } = req.body || {};
    if (!contactProperties || !dealProperties || !quoteStageMap || !orderStageMap || !leadStatusMap) {
      return next(createError(400, 'All CRM property and status mappings are required.'));
    }
    for (const [provided, allowed] of [[contactProperties, CONTACT_KEYS], [dealProperties, DEAL_KEYS]]) {
      if (Object.keys(provided).some((key) => !allowed.includes(key)) ||
        allowed.some((key) => typeof provided[key] !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(provided[key]))) {
        return next(createError(400, 'CRM property mappings contain unknown keys or invalid property names.'));
      }
    }
    if (contactProperties.email !== 'email' ||
      new Set(Object.values(contactProperties)).size !== CONTACT_KEYS.length ||
      new Set(Object.values(dealProperties)).size !== DEAL_KEYS.length) {
      return next(createError(400, 'Contact mappings must retain HubSpot email as the identity key and use distinct properties.'));
    }
    const propertyLists = await Promise.all([
      hubspot.apiRequest('GET', '/crm/v3/properties/contacts'),
      hubspot.apiRequest('GET', '/crm/v3/properties/deals'),
    ]);
    const contactSchema = new Map((propertyLists[0].results || []).map((property) => [property.name, property]));
    const dealSchema = new Map((propertyLists[1].results || []).map((property) => [property.name, property]));
    const contactTypes = Object.fromEntries(CONTACT_KEYS.map((key) => [
      contactProperties[key],
      key === 'marketingConsent' ? ['bool'] : key === 'leadStatus' ? ['enumeration'] : ['string'],
    ]));
    const invalidContactProperty = Object.entries(contactTypes).find(([name, types]) =>
      !contactSchema.has(name) || !types.includes(contactSchema.get(name).type));
    const invalidDealProperty = Object.values(dealProperties).find((name) =>
      !dealSchema.has(name) || dealSchema.get(name).type !== 'string');
    if (invalidContactProperty || invalidDealProperty ||
      dealSchema.get(dealProperties.syncKey)?.hasUniqueValue !== true) {
      return next(createError(400, 'Mapped HubSpot properties must exist with compatible field types; deal sync key must be unique.'));
    }
    const leadStatusProperty = contactSchema.get(contactProperties.leadStatus);
    const invalidLeadStatus = Object.keys(req.body.leadStatusMap).some((value) =>
      leadStatusProperty.options?.length && !leadStatusProperty.options.some((option) => option.value === value));
    if (invalidLeadStatus) {
      return next(createError(400, 'Lead status mappings must use values defined by the selected HubSpot contact property.'));
    }
    const mapStatus = (mapping, allowedStatuses) => {
      if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) ||
        Object.entries(mapping).some(([key, value]) => !/^[A-Za-z0-9_-]{1,100}$/.test(key) || !allowedStatuses.includes(value))) {
        throw createError(400, 'CRM status mappings contain an invalid value.');
      }
      return mapping;
    };
    const quoteStageMapValue = mapStatus(quoteStageMap, QUOTE_STATES);
    const orderStageMapValue = mapStatus(orderStageMap, ORDER_STATES);
    if (Object.keys(quoteStageMapValue).length) {
      const pipeline = process.env.HUBSPOT_QUOTES_PIPELINE_ID;
      if (!pipeline) {return next(createError(400, 'HUBSPOT_QUOTES_PIPELINE_ID is required to validate quote stages.'));}
      const result = await hubspot.apiRequest('GET', `/crm/v3/pipelines/deals/${encodeURIComponent(pipeline)}`);
      const stageIds = new Set((result.stages || []).map((stage) => stage.id));
      if (Object.keys(quoteStageMapValue).some((stageId) => !stageIds.has(stageId))) {
        return next(createError(400, 'Quote stage mappings contain IDs outside the configured Quotes pipeline.'));
      }
    }
    if (Object.keys(orderStageMapValue).length) {
      const pipeline = process.env.HUBSPOT_ORDERS_PIPELINE_ID;
      if (!pipeline) {return next(createError(400, 'HUBSPOT_ORDERS_PIPELINE_ID is required to validate order stages.'));}
      const result = await hubspot.apiRequest('GET', `/crm/v3/pipelines/deals/${encodeURIComponent(pipeline)}`);
      const stageIds = new Set((result.stages || []).map((stage) => stage.id));
      if (Object.keys(orderStageMapValue).some((stageId) => !stageIds.has(stageId))) {
        return next(createError(400, 'Order stage mappings contain IDs outside the configured Orders pipeline.'));
      }
    }
    const config = await CrmConfig.findOneAndUpdate(
      { singletonKey: 'hubspot' },
      {
        $set: {
          contactProperties,
          dealProperties,
          quoteStageMap: quoteStageMapValue,
          orderStageMap: orderStageMapValue,
          leadStatusMap: mapStatus(leadStatusMap, LEAD_STATES),
        },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    res.json({ success: true, data: config });
  } catch (error) {next(error);}
}

module.exports = { crmDashboard, getCrmConfig, updateCrmConfig };
