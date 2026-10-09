'use strict';

const API_URL = 'https://api.goshippo.com';

function getMode() {
  const mode = (process.env.SHIPPING_MODE || 'sandbox').toLowerCase();
  if (!['sandbox', 'live'].includes(mode)) {
    throw new Error('SHIPPING_MODE must be "sandbox" or "live".');
  }
  return mode;
}

async function getRates({ address, parcels }) {
  const token = process.env.SHIPPO_API_TOKEN;
  if (!token) return null;

  const origin = {
    name: process.env.SHIPPING_ORIGIN_NAME || 'Shadesology',
    street1: process.env.SHIPPING_ORIGIN_STREET1,
    city: process.env.SHIPPING_ORIGIN_CITY,
    state: process.env.SHIPPING_ORIGIN_STATE,
    zip: process.env.SHIPPING_ORIGIN_ZIP,
    country: process.env.SHIPPING_ORIGIN_COUNTRY || 'US',
    phone: process.env.SHIPPING_ORIGIN_PHONE,
    email: process.env.SHIPPING_ORIGIN_EMAIL,
  };
  if (!origin.street1 || !origin.city || !origin.state || !origin.zip) {
    throw new Error('Shippo rate lookup requires complete SHIPPING_ORIGIN_* address settings.');
  }

  const response = await fetch(`${API_URL}/shipments/`, {
    method: 'POST',
    headers: {
      Authorization: `ShippoToken ${token}`,
      'Content-Type': 'application/json',
      'SHIPPO-API-VERSION': '2018-02-08',
    },
    body: JSON.stringify({
      address_from: origin,
      address_to: {
        name: `${address.firstName || ''} ${address.lastName || ''}`.trim() || 'Customer',
        street1: address.line1,
        street2: address.line2 || '',
        city: address.city,
        state: address.state,
        zip: address.zip,
        country: address.country || 'US',
        phone: address.phone || '',
      },
      parcels,
      async: false,
    }),
  });
  const shipment = await response.json();
  if (!response.ok) {
    throw new Error(`Shippo rate request failed (${response.status}): ${shipment.detail || shipment.message || 'provider error'}`);
  }

  const rates = (shipment.rates || [])
    .filter((rate) => rate.object_status === 'VALID' && Number.isFinite(Number(rate.amount)))
    .sort((a, b) => Number(a.amount) - Number(b.amount));
  if (rates.length === 0) {
    throw new Error('Shippo returned no valid shipping rates for this destination.');
  }
  const preferredCarrier = process.env.SHIPPO_CARRIER_NAME;
  const selected = preferredCarrier
    ? rates.find((rate) => rate.provider.toLowerCase() === preferredCarrier.toLowerCase())
    : rates[0];
  if (!selected) throw new Error(`Shippo returned no rate for configured carrier "${preferredCarrier}".`);

  const cost = Math.round(Number(selected.amount) * 100) / 100;
  if (!Number.isFinite(cost) || cost < 0) {
    throw new Error('Shippo returned an invalid shipping amount.');
  }
  const days = Number(selected.estimated_days);
  return {
    rateId: selected.object_id,
    carrierName: selected.provider,
    label: selected.servicelevel?.name || selected.servicelevel_name || 'Standard delivery',
    cost,
    transitDays: Number.isFinite(days) && days > 0 ? Math.ceil(days) : null,
    mode: getMode(),
  };
}

module.exports = { getRates, getMode };
