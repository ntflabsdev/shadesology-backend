'use strict';

/**
 * Admin Orders router — /admin/orders
 *
 * Staff can view all orders, update status, and export for production.
 * Orders are read-only from an admin data perspective (items + prices are locked).
 * Status transitions and production export are the main admin actions.
 */

const express = require('express');
const Order   = require('../../models/Order');
const stripe  = require('../../services/payments/stripe');
const { enqueueOrderEmail } = require('../../services/orderNotifications');
const { normalizeOrderForResponse } = require('../../services/orderFormatting');
const { createError } = require('../../middlewares/errorHandler');

const router = express.Router();

router.post('/:id/balance-payment', async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return next(createError(404, 'Order not found.'));
    if (order.paymentMethod !== 'stripe_checkout' || order.paymentStatus !== 'deposit_paid' || order.balanceDue <= 0) {
      return next(createError(409, 'This order does not have a collectible Stripe balance.'));
    }
    const session = await stripe.createCheckoutSession({
      order,
      customerEmail: order.guestEmail || req.body.email,
      amountToCollect: order.balanceDue,
      paymentPurpose: 'balance',
      successUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/account/orders?payment=complete`,
      cancelUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/account/orders?payment=cancelled`,
      idempotencyKey: `balance-${order._id}-${order.balanceDue}`,
    });
    order.stripeCheckoutSessionId = session.id;
    order.paymentCheckoutUrl = session.url;
    await order.save();
    res.json({ success: true, url: session.url, expiresAt: new Date(session.expires_at * 1000) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/refunds', async (req, res, next) => {
  try {
    const { amount, reason } = req.body;
    const requestKey = req.get('Idempotency-Key');
    if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) {
      return next(createError(400, 'Refund amount must be a positive USD amount with no more than two decimal places.'));
    }
    if (!requestKey || !/^[a-zA-Z0-9_-]{16,100}$/.test(requestKey)) {
      return next(createError(400, 'A valid Idempotency-Key header is required.'));
    }
    const order = await Order.findById(req.params.id);
    if (!order) return next(createError(404, 'Order not found.'));
    const priorRefund = order.refunds.find((refund) => refund.requestKey === requestKey);
    if (priorRefund) return res.json({ success: true, data: order, duplicate: true });

    const alreadyRefunded = order.refundAmount || 0;
    if (amount > order.total - alreadyRefunded) {
      return next(createError(422, 'Refund exceeds the remaining refundable order balance.'));
    }
    let providerRefundId = null;
    if (order.paymentMethod === 'stripe_checkout') {
      const transaction = [...order.paymentTransactions].reverse().find((payment) =>
        payment.paymentIntentId &&
        payment.amount - payment.refundedAmount >= amount
      );
      const paymentIntentId = transaction?.paymentIntentId || order.paymentIntentId;
      if (!paymentIntentId) return next(createError(409, 'No captured Stripe payment is available to refund.'));
      const refund = await stripe.createRefund({
        paymentIntentId,
        amount,
        idempotencyKey: `refund-${requestKey}`,
      });
      providerRefundId = refund.id;
    }

    order.refunds.push({ amount, providerRefundId, requestKey, reason: reason || '' });
    order.refundAmount = alreadyRefunded + amount;
    order.paymentStatus = order.refundAmount >= order.total ? 'fully_refunded' : 'partially_refunded';
    if (order.paymentStatus === 'fully_refunded') {
      order.status = 'refunded';
      order.refundedAt = new Date();
      order.statusHistory.push({ status: 'refunded', note: `Full refund recorded by ${req.user.email}.`, changedBy: req.user._id });
    }
    await order.save();
    if (order.paymentStatus === 'fully_refunded') {
      await enqueueOrderEmail(order, 'refunded', { note: reason || 'A full refund has been recorded for your order.' });
    }
    res.json({
      success: true,
      data: order,
      ...(order.paymentMethod !== 'stripe_checkout' ? { notice: 'Record the bank refund with the customer’s bank; the order has been marked refunded.' } : {}),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/record-transfer', async (req, res, next) => {
  try {
    const { amount } = req.body;
    if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) {
      return next(createError(400, 'Transfer amount must be a positive USD amount with no more than two decimal places.'));
    }
    const order = await Order.findById(req.params.id);
    if (!order) return next(createError(404, 'Order not found.'));
    if (order.paymentMethod !== 'bank_transfer' || !['pending', 'deposit_paid'].includes(order.paymentStatus)) {
      return next(createError(409, 'This order is not awaiting a bank transfer.'));
    }
    if (amount > order.balanceDue || amount > order.total - (order.balancePaid || 0)) {
      return next(createError(422, 'Transfer amount exceeds the remaining balance.'));
    }
    const transitionedToConfirmed = order.status === 'pending';
    order.balancePaid = (order.balancePaid || 0) + amount;
    order.balanceDue = Math.max(0, order.total - order.balancePaid);
    order.paymentStatus = order.balanceDue === 0 ? 'paid' : 'deposit_paid';
    if (order.status === 'pending') {
      order.status = 'confirmed';
      order.statusHistory.push({
        status: 'confirmed',
        note: `Bank transfer of $${amount.toFixed(2)} recorded by ${req.user.email}.`,
        changedBy: req.user._id,
      });
    }
    await order.save();
    if (transitionedToConfirmed) {
      await enqueueOrderEmail(order, 'confirmed', {
        note: `A bank transfer of $${amount.toFixed(2)} was recorded. ${order.balanceDue > 0 ? `The remaining $${order.balanceDue.toFixed(2)} is due before dispatch.` : 'Your order is paid in full.'}`,
      });
    } else if (order.balanceDue === 0) {
      await enqueueOrderEmail(order, 'balance_paid', { note: 'Your remaining bank transfer balance has been recorded as paid.' });
    }
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
});

// ─── GET /admin/orders — List orders with filters ─────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const {
      page   = 1,
      limit  = 25,
      status,
      search,
      sort   = '-createdAt',
    } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { orderNumber: { $regex: search, $options: 'i' } },
        { guestEmail:  { $regex: search, $options: 'i' } },
      ];
    }

    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate('user', 'firstName lastName email role')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Order.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data:  orders.map(normalizeOrderForResponse),
      meta:  { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /admin/orders/:id — Single order with full detail ───────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'firstName lastName email role pricingGroup')
      .populate('items.product', 'name slug images')
      .populate('items.variant', 'name sku')
      .lean();

    if (!order) return next(createError(404, 'Order not found.'));
    res.json({ success: true, data: normalizeOrderForResponse(order) });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /admin/orders/:id/status — Update order status ───────────────────
const VALID_TRANSITIONS = {
  pending:            ['payment_processing', 'cancelled'],
  payment_processing: ['confirmed', 'cancelled'],
  confirmed:          ['in_production', 'cancelled'],
  in_production:      ['ready_to_ship'],
  ready_to_ship:      ['shipped'],
  shipped:            ['delivered'],
  delivered:          ['refunded'],
  cancelled:          [],
  refunded:           [],
};

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status, note, trackingNumber, trackingUrl, carrierName, estimatedDeliveryDate } = req.body;
    if (typeof status !== 'string' || !status) {
      return next(createError(400, 'status is required.'));
    }
    if (note !== undefined && (typeof note !== 'string' || note.length > 1000)) {
      return next(createError(400, 'note must be 1000 characters or fewer.'));
    }
    for (const [value, label, max] of [
      [trackingNumber, 'trackingNumber', 150],
      [trackingUrl, 'trackingUrl', 2000],
      [carrierName, 'carrierName', 100],
    ]) {
      if (value !== undefined && (typeof value !== 'string' || value.length > max)) {
        return next(createError(400, `${label} must be a string of at most ${max} characters.`));
      }
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return next(createError(404, 'Order not found.'));
    }

    if (order.status === status) {
      const job = await enqueueOrderEmail(order, status);
      return res.json({ success: true, data: normalizeOrderForResponse(order), notificationRetried: true, notificationJobId: job.id });
    }
    const allowed = VALID_TRANSITIONS[order.status] || [];
    if (!allowed.includes(status)) {
      return next(createError(422, `Cannot transition from "${order.status}" to "${status}".`));
    }
    const normalizedTrackingNumber = trackingNumber?.trim();
    if (status === 'shipped' && !(normalizedTrackingNumber || order.trackingNumber)) {
      return next(createError(422, 'A tracking number is required before marking the order shipped.'));
    }
    if (trackingUrl && !/^https?:\/\/\S+$/i.test(trackingUrl)) {
      return next(createError(400, 'trackingUrl must be a valid http(s) URL.'));
    }
    if (estimatedDeliveryDate && Number.isNaN(Date.parse(estimatedDeliveryDate))) {
      return next(createError(400, 'estimatedDeliveryDate must be a valid date.'));
    }

    order.status = status;
    if (trackingNumber !== undefined) {
      order.trackingNumber = normalizedTrackingNumber;
    }
    if (trackingUrl !== undefined) {
      order.trackingUrl = String(trackingUrl).trim();
    }
    if (carrierName !== undefined) {
      order.carrierName = String(carrierName).trim();
    }
    if (estimatedDeliveryDate !== undefined) {
      order.estimatedDeliveryDate = new Date(estimatedDeliveryDate);
    }
    order.statusHistory.push({
      status,
      note:      note || '',
      changedBy: req.user._id,
      at:        new Date(),
    });

    await order.save();
    await enqueueOrderEmail(order, status, { note: note || '' });

    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/requests/:requestId', async (req, res, next) => {
  try {
    const { status, resolutionNote = '' } = req.body;
    if (!['approved', 'declined'].includes(status)) {
      return next(createError(400, 'Request status must be approved or declined.'));
    }
    if (typeof resolutionNote !== 'string' || resolutionNote.length > 1000) {
      return next(createError(400, 'resolutionNote must be 1000 characters or fewer.'));
    }
    const order = await Order.findById(req.params.id);
    if (!order) {
      return next(createError(404, 'Order not found.'));
    }
    const request = order.customerRequests.id(req.params.requestId);
    if (!request) {
      return next(createError(404, 'Customer request not found.'));
    }
    if (request.status === status) {
      await enqueueOrderEmail(order, status === 'approved' && request.type === 'cancellation'
        ? 'cancelled'
        : `${request.type}_request_${status}`, {
        note: request.resolutionNote || `Your ${request.type} request was ${status}.`,
        dedupeKey: request._id.toString(),
      });
      return res.json({ success: true, data: request, duplicate: true });
    }
    if (request.status !== 'pending') {
      return next(createError(409, 'This customer request has already been reviewed.'));
    }
    if (request.type === 'cancellation' && status === 'approved') {
      if (!['pending', 'payment_processing', 'confirmed'].includes(order.status)) {
        return next(createError(409, 'Cancellation cannot be approved after production or shipment begins.'));
      }
      order.status = 'cancelled';
      order.cancellationReason = request.reason;
      order.statusHistory.push({
        status: 'cancelled',
        note: resolutionNote || 'Customer cancellation request approved.',
        changedBy: req.user._id,
        at: new Date(),
      });
    }
    request.status = status;
    request.resolutionNote = resolutionNote.trim();
    request.reviewedAt = new Date();
    request.reviewedBy = req.user._id;
    await order.save();
    await enqueueOrderEmail(order, status === 'approved' && request.type === 'cancellation'
      ? 'cancelled'
      : `${request.type}_request_${status}`, {
      note: request.resolutionNote || `Your ${request.type} request was ${status}.`,
      dedupeKey: request._id.toString(),
    });
    res.json({ success: true, data: request });
  } catch (err) {
    next(err);
  }
});

// ─── GET /admin/orders/:id/export — Production export (CSV) ─────────────────
router.get('/:id/export', async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('items.product', 'name slug')
      .populate('items.variant', 'name sku')
      .lean();

    if (!order) return next(createError(404, 'Order not found.'));

    const csvCell = (value) => {
      let text = String(value ?? '');
      if (/^[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = [[
      'Order Number', 'Order Status', 'Payment Status', 'SKU', 'Product', 'Variant',
      'Availability', 'Qty', 'Unit Price', 'Surcharges', 'Line Total', 'Options',
      'Ship To', 'Carrier', 'Tracking Number', 'Estimated Delivery',
    ].map(csvCell).join(',')];

    for (const item of order.items) {
      const selectedOptions = item.selectedOptions instanceof Map
        ? [...item.selectedOptions.entries()]
        : Object.entries(item.selectedOptions || {});
      const optionsStr = JSON.stringify(Object.fromEntries(
        selectedOptions.map(([key, value]) => [key, value?.value ?? value])
      ));
      const surchargeText = (item.surcharges || []).map((charge) =>
        `${charge.label}: ${Number(charge.amount || 0).toFixed(2)}`
      ).join('; ');
      rows.push([
        order.orderNumber,
        order.status,
        order.paymentStatus,
        item.sku || '',
        item.productName || '',
        item.variantName || '',
        item.availability || 'made_to_order',
        item.quantity,
        item.unitPrice?.toFixed(2) ?? '0.00',
        surchargeText || item.totalSurcharge?.toFixed(2) || '0.00',
        item.lineTotal?.toFixed(2) ?? '0.00',
        optionsStr,
        [
          order.shippingAddress?.firstName,
          order.shippingAddress?.lastName,
          order.shippingAddress?.line1,
          order.shippingAddress?.line2,
          order.shippingAddress?.city,
          order.shippingAddress?.state,
          order.shippingAddress?.zip,
          order.shippingAddress?.country,
        ].filter(Boolean).join(', '),
        order.carrierName || '',
        order.trackingNumber || '',
        order.estimatedDeliveryDate ? new Date(order.estimatedDeliveryDate).toISOString() : '',
      ].map(csvCell).join(','));
    }

    const csv = rows.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="order-${order.orderNumber}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// ─── GET /admin/orders/stats — Dashboard stats ───────────────────────────────
router.get('/stats/summary', async (req, res, next) => {
  try {
    const [totalOrders, pendingOrders, confirmedOrders, recentRevenue] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ status: 'pending' }),
      Order.countDocuments({ status: { $in: ['confirmed', 'in_production', 'ready_to_ship', 'shipped'] } }),
      Order.aggregate([
        { $match: { status: { $in: ['confirmed', 'in_production', 'ready_to_ship', 'shipped', 'delivered'] }, createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
        { $group: { _id: null, revenue: { $sum: '$total' } } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        totalOrders,
        pendingOrders,
        confirmedOrders,
        revenueLastThirtyDays: recentRevenue[0]?.revenue ?? 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
