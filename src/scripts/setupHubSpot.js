'use strict';

require('dotenv').config();

const hubspot = require('../services/hubspot');

const definitions = {
  contacts: [
    ['lead_source', 'Shadesology lead source', 'string', 'text'],
    ['segment', 'Customer segment', 'string', 'text'],
    ['lead_status', 'Shadesology lead status', 'enumeration', 'select', [
      'new', 'assigned', 'contacted', 'closed',
    ].map((value, displayOrder) => ({
      label: value.replaceAll('_', ' '),
      value,
      displayOrder,
      hidden: false,
    }))],
    ['enquiry_type', 'Enquiry type', 'string', 'text'],
    ['product_interest', 'Product interest', 'string', 'text'],
    ['pricing_tier', 'Pricing tier', 'string', 'text'],
    ['shadesology_marketing_consent', 'Marketing consent recorded', 'bool', 'booleancheckbox'],
    ['shadesology_commercial_flag', 'Commercial lead', 'bool', 'booleancheckbox'],
    ['shadesology_lead_queue', 'Shadesology lead queue', 'string', 'text'],
    ['newsletter_interests', 'Newsletter interests', 'string', 'text'],
    ['shadesology_abandoned_cart_item_count', 'Abandoned cart item count', 'number', 'number'],
  ],
  deals: [
    ['shadesology_sync_key', 'Shadesology sync key', 'string', 'text'],
    ['shadesology_deal_type', 'Shadesology deal type', 'string', 'text'],
    ['shadesology_quote_ref', 'Shadesology quote reference', 'string', 'text'],
    ['shadesology_order_ref', 'Shadesology order reference', 'string', 'text'],
    ['shadesology_commercial_flag', 'Commercial lead', 'bool', 'booleancheckbox'],
  ],
};

async function ensureProperty(objectType, [name, label, type, fieldType, options]) {
  const existing = await hubspot.apiRequest('GET', `/crm/v3/properties/${objectType}/${name}`)
    .then(() => true)
    .catch((error) => {
      if (error.status === 404) {return false;}
      throw error;
    });
  if (existing) {
    console.info(`[HubSpot setup] ${objectType}.${name} already exists.`);
    return;
  }
  await hubspot.apiRequest('POST', `/crm/v3/properties/${objectType}`, {
    name,
    label,
    type,
    fieldType,
    groupName: objectType === 'deals' ? 'dealinformation' : 'contactinformation',
    ...(objectType === 'deals' && name === 'shadesology_sync_key' ? { hasUniqueValue: true } : {}),
    ...(options ? { options } : {}),
    description: 'Managed by the Shadesology integration. Do not rename or delete.',
  });
  console.info(`[HubSpot setup] Created ${objectType}.${name}.`);
}

async function main() {
  for (const [objectType, properties] of Object.entries(definitions)) {
    for (const property of properties) {await ensureProperty(objectType, property);}
  }
}

main().catch((error) => {
  console.error('[HubSpot setup] Failed:', error.message);
  process.exitCode = 1;
});
