'use strict';

const API_URL = 'https://api.stripe.com/v1';

function getMode() {
  const mode = (process.env.PAYMENTS_MODE || 'sandbox').toLowerCase();
  if (!['sandbox', 'live'].includes(mode)) {
    throw new Error('PAYMENTS_MODE must be "sandbox" or "live".');
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe is not configured: STRIPE_SECRET_KEY is required.');
  if ((mode === 'live' && !key.startsWith('sk_live_')) || (mode === 'sandbox' && !key.startsWith('sk_test_'))) {
    throw new Error(`Stripe secret key does not match PAYMENTS_MODE=${mode}.`);
  }
  return mode;
}

async function request(path, params, idempotencyKey) {
  getMode();
  const response = await fetch(`${API_URL}${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    ...(params ? { body: new URLSearchParams(params).toString() } : {}),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`Stripe request failed (${response.status}): ${result.error?.message || 'provider error'}`);
  }
  return result;
}

async function createCheckoutSession({
  order,
  customerEmail,
  amountToCollect,
  successUrl,
  cancelUrl,
  idempotencyKey,
  paymentPurpose = 'order',
}) {
  const params = {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: customerEmail,
    'payment_method_types[0]': 'card',
    'payment_method_types[1]': 'link',
    'line_items[0][price_data][currency]': order.currency.toLowerCase(),
    'line_items[0][price_data][product_data][name]': paymentPurpose === 'balance'
      ? `Balance due for Shadesology order ${order.orderNumber}`
      : `Shadesology order ${order.orderNumber}`,
    'line_items[0][price_data][product_data][description]': paymentPurpose === 'balance'
      ? 'Remaining balance due before dispatch'
      : `${order.items.length} item(s); includes shipping and estimated tax`,
    'line_items[0][price_data][unit_amount]': String(Math.round(amountToCollect * 100)),
    'line_items[0][quantity]': '1',
    'metadata[orderId]': order._id.toString(),
    'metadata[orderNumber]': order.orderNumber,
    'metadata[checkoutKey]': idempotencyKey,
    'metadata[paymentPurpose]': paymentPurpose,
    'payment_intent_data[metadata][orderId]': order._id.toString(),
    'payment_intent_data[metadata][orderNumber]': order.orderNumber,
  };
  return request('/checkout/sessions', params, idempotencyKey);
}

async function createRefund({ paymentIntentId, amount, idempotencyKey }) {
  return request('/refunds', {
    payment_intent: paymentIntentId,
    amount: String(Math.round(amount * 100)),
  }, idempotencyKey);
}

async function calculateTax({ address, subtotal, shipping }) {
  const params = {
    currency: 'usd',
    'line_items[0][amount]': String(Math.round(subtotal * 100)),
    'line_items[0][reference]': 'order-subtotal',
    'customer_details[address][line1]': address.line1,
    'customer_details[address][city]': address.city,
    'customer_details[address][state]': address.state,
    'customer_details[address][postal_code]': address.zip,
    'customer_details[address][country]': address.country || 'US',
    'customer_details[address_source]': 'shipping',
    'shipping_cost[amount]': String(Math.round(shipping * 100)),
  };
  const result = await request('/tax/calculations', params);
  const amount = Number(result.tax_amount_exclusive) / 100;
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Stripe Tax returned an invalid amount.');
  }
  const breakdownRate = Number(result.tax_breakdown?.[0]?.tax_rate_details?.percentage_decimal);
  return {
    amount,
    rate: Number.isFinite(breakdownRate) ? breakdownRate / 100 : null,
    provider: 'stripe_tax',
    mode: getMode(),
  };
}

async function retrieveCheckoutSession(sessionId) {
  return request(`/checkout/sessions/${encodeURIComponent(sessionId)}`, null);
}

module.exports = {
  getMode,
  createCheckoutSession,
  createRefund,
  calculateTax,
  retrieveCheckoutSession,
};
