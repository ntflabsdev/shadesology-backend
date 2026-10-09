'use strict';

const stripe = require('./payments/stripe');

async function calculateTax({ address, subtotal, shipping }) {
  const provider = (process.env.TAX_PROVIDER || 'taxjar').toLowerCase();
  if (provider === 'stripe_tax') {
    return stripe.calculateTax({ address, subtotal, shipping });
  }
  if (provider !== 'taxjar') {
    throw new Error(`Unsupported TAX_PROVIDER "${provider}". Use stripe_tax or taxjar.`);
  }
  const mode = (process.env.TAX_MODE || 'sandbox').toLowerCase();
  if (!['sandbox', 'live'].includes(mode)) {
    throw new Error('TAX_MODE must be "sandbox" or "live".');
  }
  const token = process.env.TAXJAR_API_KEY;
  if (!token) throw new Error('Tax service is not configured: TAXJAR_API_KEY is required.');
  const origin = {
    country: process.env.TAX_ORIGIN_COUNTRY || process.env.SHIPPING_ORIGIN_COUNTRY || 'US',
    zip: process.env.TAX_ORIGIN_ZIP || process.env.SHIPPING_ORIGIN_ZIP,
    state: process.env.TAX_ORIGIN_STATE || process.env.SHIPPING_ORIGIN_STATE,
    city: process.env.TAX_ORIGIN_CITY || process.env.SHIPPING_ORIGIN_CITY,
    street: process.env.TAX_ORIGIN_STREET || process.env.SHIPPING_ORIGIN_STREET1,
  };
  if (!origin.zip || !origin.state) throw new Error('Tax calculation requires TAX_ORIGIN_ZIP and TAX_ORIGIN_STATE.');
  const amount = subtotal;
  const shippingAmount = shipping;
  const baseUrl = mode === 'live' ? 'https://api.taxjar.com' : 'https://api.sandbox.taxjar.com';
  const response = await fetch(`${baseUrl}/v2/taxes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_country: origin.country,
      from_zip: origin.zip,
      from_state: origin.state,
      from_city: origin.city,
      from_street: origin.street,
      to_country: address.country || 'US',
      to_zip: address.zip,
      to_state: address.state,
      to_city: address.city,
      to_street: address.line1,
      amount,
      shipping: shippingAmount,
      nexus_addresses: [{ country: origin.country, zip: origin.zip, state: origin.state }],
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`TaxJar calculation failed (${response.status}): ${result.error || result.detail || 'provider error'}`);
  }
  const tax = Math.round(Number(result.tax?.amount_to_collect) * 100) / 100;
  if (!Number.isFinite(tax) || tax < 0) throw new Error('Tax service returned an invalid amount.');
  return {
    amount: tax,
    rate: Number.isFinite(Number(result.tax?.rate)) ? Number(result.tax.rate) : null,
    provider: 'taxjar',
    mode,
  };
}

module.exports = { calculateTax };
