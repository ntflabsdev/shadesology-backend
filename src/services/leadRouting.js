'use strict';

const LeadRoutingConfig = require('../models/LeadRoutingConfig');
const { getBusinessHoursStatus } = require('./chat');

function selectLeadRule(rules, lead) {
  const matchingRules = rules.filter((rule) =>
    (!rule.enquiryType || rule.enquiryType === lead.enquiryType) &&
    (!rule.productType || rule.productType === lead.productType) &&
    (!rule.region || rule.region.toLowerCase() === (lead.region || '').toLowerCase())
  );
  matchingRules.sort((a, b) =>
    Number(Boolean(b.enquiryType)) + Number(Boolean(b.productType)) + Number(Boolean(b.region)) -
    (Number(Boolean(a.enquiryType)) + Number(Boolean(a.productType)) + Number(Boolean(a.region)))
  );
  return matchingRules[0];
}

async function resolveLeadRecipient(lead) {
  let config;
  try {
    config = await LeadRoutingConfig.findOne({ key: 'default' }).lean();
  } catch (err) {
    console.error('[LeadRouting] Could not read configured rules; using the default recipient:', err.message);
    return process.env.LEADS_NOTIFY_EMAIL || process.env.SES_REPLY_TO || process.env.SES_FROM_EMAIL || '';
  }
  const rules = config?.rules || [];
  const configuredRule = selectLeadRule(rules, lead);
  const explicitChatRule = configuredRule &&
    (configuredRule.enquiryType === 'chat' || configuredRule.productType || configuredRule.region);
  if (configuredRule && (lead.enquiryType !== 'chat' || explicitChatRule)) {
    return configuredRule.notifyEmail;
  }
  if (lead.enquiryType === 'chat') {
    const chatStatus = getBusinessHoursStatus();
    const chatRecipient = chatStatus.online
      ? process.env.CHAT_BUSINESS_HOURS_NOTIFY_EMAIL
      : process.env.CHAT_OFFLINE_NOTIFY_EMAIL;
    if (chatRecipient) {return chatRecipient;}
  }
  return configuredRule?.notifyEmail || process.env.LEADS_NOTIFY_EMAIL || process.env.SES_REPLY_TO || process.env.SES_FROM_EMAIL || '';
}

module.exports = { resolveLeadRecipient, selectLeadRule };
