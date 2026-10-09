'use strict';

const User = require('../models/User');
const { getQueue } = require('../queues');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function optionText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(optionText).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    if ('value' in value) {
      return optionText(value.value);
    }
    return Object.entries(value).map(([key, entry]) => `${key}: ${optionText(entry)}`).join('; ');
  }
  return '';
}

function selectedOptionEntries(item) {
  return item.selectedOptions instanceof Map
    ? [...item.selectedOptions.entries()]
    : Object.entries(item.selectedOptions || {});
}

async function resolveRecipient(order) {
  if (order.guestEmail) {
    return { email: order.guestEmail, name: order.guestName || 'Customer' };
  }
  const user = order.user?.email
    ? order.user
    : order.user
      ? await User.findById(order.user).select('firstName lastName email').lean()
      : null;
  if (!user?.email) {
    throw new Error(`Cannot notify order ${order.orderNumber}: customer email is unavailable.`);
  }
  return {
    email: user.email,
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Customer',
  };
}

function orderItemsHtml(order) {
  return (order.items || []).map((item) => {
    const options = selectedOptionEntries(item)
      .map(([key, value]) => `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(optionText(value))}</li>`)
      .join('');
    const surcharges = (item.surcharges || []).map((charge) =>
      `<li>${escapeHtml(charge.label)}: ${Number(charge.amount || 0).toFixed(2)}</li>`
    ).join('');
    return `<li><strong>${escapeHtml(item.productName)}${item.variantName ? ` — ${escapeHtml(item.variantName)}` : ''}</strong> (SKU ${escapeHtml(item.sku || 'N/A')}) × ${Number(item.quantity) || 0} — ${Number(item.lineTotal || 0).toFixed(2)}${options ? `<ul>${options}</ul>` : ''}${surcharges ? `<ul>${surcharges}</ul>` : ''}</li>`;
  }).join('');
}

function orderItemsText(order) {
  return (order.items || []).map((item) => {
    const options = selectedOptionEntries(item)
      .map(([key, value]) => `  - ${key}: ${optionText(value)}`);
    const surcharges = (item.surcharges || []).map((charge) =>
      `  - ${charge.label}: ${Number(charge.amount || 0).toFixed(2)}`
    );
    return [
      `${item.productName}${item.variantName ? ` — ${item.variantName}` : ''} (SKU ${item.sku || 'N/A'}) × ${Number(item.quantity) || 0}: ${Number(item.lineTotal || 0).toFixed(2)}`,
      ...options,
      ...surcharges,
    ].join('\n');
  }).join('\n');
}

async function enqueueOrderEmail(order, event, details = {}) {
  const recipient = await resolveRecipient(order);
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const orderUrl = `${frontendUrl}/account/orders`;
  const eventLabels = {
    received: 'Order received',
    confirmed: 'Order confirmed',
    payment_processing: 'Payment processing',
    payment_failed: 'Payment could not be completed',
    balance_paid: 'Order balance paid',
    in_production: 'Your order is in production',
    ready_to_ship: 'Your order is ready to ship',
    shipped: 'Your order has shipped',
    delivered: 'Your order was delivered',
    cancelled: 'Order cancelled',
    refunded: 'Order refunded',
    return_request: 'Return request received',
    cancellation_request: 'Cancellation request received',
    return_request_approved: 'Return request reviewed',
    return_request_declined: 'Return request reviewed',
    cancellation_request_approved: 'Cancellation request reviewed',
    cancellation_request_declined: 'Cancellation request reviewed',
  };
  const label = eventLabels[event] || `Order update: ${event}`;
  const statusMessage = details.note ? `<p>${escapeHtml(details.note)}</p>` : '';
  const safeTrackingUrl = /^https?:\/\/\S+$/i.test(order.trackingUrl || '') ? order.trackingUrl : '';
  const tracking = event === 'shipped' && order.trackingNumber
    ? `<p><strong>Carrier:</strong> ${escapeHtml(order.carrierName || 'Carrier')}<br><strong>Tracking number:</strong> ${escapeHtml(order.trackingNumber)}${safeTrackingUrl ? `<br><a href="${escapeHtml(safeTrackingUrl)}">Track shipment</a>` : ''}${order.estimatedDeliveryDate ? `<br><strong>Estimated delivery:</strong> ${new Date(order.estimatedDeliveryDate).toLocaleDateString('en-US')}` : ''}</p>`
    : '';
  const bankInstructions = event === 'received' && order.paymentMethod === 'bank_transfer'
    ? `<p>To begin processing, transfer $${Number(order.depositAmount ?? order.total).toFixed(2)} and use <strong>${escapeHtml(order.orderNumber)}</strong> as the reference.${process.env.BANK_TRANSFER_BANK_NAME ? `<br>Bank: ${escapeHtml(process.env.BANK_TRANSFER_BANK_NAME)}` : ''}${process.env.BANK_TRANSFER_ACCOUNT_NAME ? `<br>Account name: ${escapeHtml(process.env.BANK_TRANSFER_ACCOUNT_NAME)}` : ''}${process.env.BANK_TRANSFER_ACCOUNT_NUMBER ? `<br>Account number: ${escapeHtml(process.env.BANK_TRANSFER_ACCOUNT_NUMBER)}` : ''}${process.env.BANK_TRANSFER_ROUTING_NUMBER ? `<br>Routing number: ${escapeHtml(process.env.BANK_TRANSFER_ROUTING_NUMBER)}` : ''}</p>`
    : '';
  const bankInstructionsText = event === 'received' && order.paymentMethod === 'bank_transfer'
    ? [
        `Transfer now: $${Number(order.depositAmount ?? order.total).toFixed(2)}`,
        `Transfer reference: ${order.orderNumber}`,
        process.env.BANK_TRANSFER_BANK_NAME ? `Bank: ${process.env.BANK_TRANSFER_BANK_NAME}` : '',
        process.env.BANK_TRANSFER_ACCOUNT_NAME ? `Account name: ${process.env.BANK_TRANSFER_ACCOUNT_NAME}` : '',
        process.env.BANK_TRANSFER_ACCOUNT_NUMBER ? `Account number: ${process.env.BANK_TRANSFER_ACCOUNT_NUMBER}` : '',
        process.env.BANK_TRANSFER_ROUTING_NUMBER ? `Routing number: ${process.env.BANK_TRANSFER_ROUTING_NUMBER}` : '',
      ].filter(Boolean).join('\n')
    : '';
  const subject = `${label} — ${order.orderNumber}`;
  const html = `<main style="font-family:Arial,sans-serif;color:#202820;max-width:640px;margin:auto"><h1 style="color:#1B4332">${escapeHtml(label)}</h1><p>Hi ${escapeHtml(recipient.name)},</p><p>Order <strong>${escapeHtml(order.orderNumber)}</strong> · ${escapeHtml(order.status || 'pending')}</p>${statusMessage}${tracking}${bankInstructions}<h2>Order configuration</h2><ul>${orderItemsHtml(order)}</ul><p><strong>Subtotal:</strong> ${escapeHtml(order.currency || 'USD')} ${Number(order.subtotal || 0).toFixed(2)}<br><strong>Shipping:</strong> ${Number(order.shippingCost || 0).toFixed(2)}${order.shippingLabel ? ` (${escapeHtml(order.shippingLabel)})` : ''}<br><strong>Tax:</strong> ${Number(order.tax || 0).toFixed(2)}<br><strong>Order total:</strong> ${escapeHtml(order.currency || 'USD')} ${Number(order.total || 0).toFixed(2)}${Number(order.balanceDue) > 0 ? `<br><strong>Balance due before dispatch:</strong> ${Number(order.balanceDue).toFixed(2)}` : ''}</p><p><a href="${escapeHtml(orderUrl)}">View your orders</a></p></main>`;
  const text = [
    `${label} — ${order.orderNumber}`,
    `Hi ${recipient.name},`,
    `Order status: ${order.status || 'pending'}`,
    details.note || '',
    bankInstructionsText,
    order.trackingNumber ? `Tracking: ${order.trackingNumber}${safeTrackingUrl ? ` (${safeTrackingUrl})` : ''}` : '',
    'Order configuration:',
    orderItemsText(order),
    `Subtotal: ${order.currency || 'USD'} ${Number(order.subtotal || 0).toFixed(2)}`,
    `Shipping: ${Number(order.shippingCost || 0).toFixed(2)}${order.shippingLabel ? ` (${order.shippingLabel})` : ''}`,
    `Tax: ${Number(order.tax || 0).toFixed(2)}`,
    `Order total: ${order.currency || 'USD'} ${Number(order.total || 0).toFixed(2)}`,
    `View your orders: ${orderUrl}`,
  ].filter(Boolean).join('\n');
  const stableSuffix = [
    event === 'shipped' && order.trackingNumber ? order.trackingNumber : '',
    details.dedupeKey || '',
  ].filter(Boolean).map((value) => `-${value.replace(/[^a-zA-Z0-9_-]/g, '')}`).join('');
  const jobId = `order-${order._id}-${event}${stableSuffix}`.replace(/[^a-zA-Z0-9_-]/g, '-');
  const queue = getQueue('email');
  if (typeof queue.getJob === 'function') {
    const existingJob = await queue.getJob(jobId);
    if (existingJob) {
      if (await existingJob.getState() === 'failed') {
        await existingJob.retry('failed');
      }
      return existingJob;
    }
  }
  return queue.add('send', {
    to: recipient.email,
    subject,
    html,
    text,
    replyTo: process.env.SES_REPLY_TO,
  }, { jobId, attempts: 5, backoff: { type: 'exponential', delay: 2000 } });
}

module.exports = { enqueueOrderEmail, escapeHtml, optionText, orderItemsHtml, orderItemsText };
