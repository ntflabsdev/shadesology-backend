'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');
const Order = require('../models/Order');
const PaymentWebhookEvent = require('../models/PaymentWebhookEvent');
const stripe = require('../services/payments/stripe');
const { enqueueOrderEmail } = require('../services/orderNotifications');
const { createError } = require('../middlewares/errorHandler');

function verifyStripeSignature(rawBody, signatureHeader) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('Stripe webhook is not configured: STRIPE_WEBHOOK_SECRET is required.');
  if (!signatureHeader || !Buffer.isBuffer(rawBody)) return false;

  const parts = signatureHeader.split(',').map((part) => part.split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  return signatures.some((signature) => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const received = Buffer.from(signature, 'hex');
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

async function updatePaidOrder(session) {
  const orderId = session.metadata?.orderId;
  if (!orderId || session.payment_status !== 'paid') return;
  const order = await Order.findById(orderId);
  if (!order) throw new Error(`Stripe checkout session references missing order ${orderId}.`);
  if (session.currency?.toUpperCase() !== order.currency.toUpperCase()) {
    throw new Error(`Stripe currency mismatch for order ${order.orderNumber}.`);
  }
  const amountReceived = Number(session.amount_total) / 100;
  const isBalancePayment = session.metadata.paymentPurpose === 'balance';
  if (isBalancePayment && order.paymentStatus === 'paid') {
    await enqueueOrderEmail(order, 'balance_paid', { note: 'Your remaining order balance has been paid.' });
    return;
  }
  const expectedAmount = isBalancePayment ? order.balanceDue : (order.depositAmount || order.total);
  if (!Number.isFinite(amountReceived) || Math.round(amountReceived * 100) !== Math.round(expectedAmount * 100)) {
    throw new Error(`Stripe amount mismatch for order ${order.orderNumber}.`);
  }
  if (!isBalancePayment && (order.paymentStatus === 'paid' || order.paymentStatus === 'deposit_paid')) {
    await enqueueOrderEmail(order, 'confirmed', {
      note: order.balanceDue > 0
        ? `Your deposit is confirmed. The remaining $${order.balanceDue.toFixed(2)} is due before dispatch.`
        : 'Your payment is confirmed and the order is being prepared.',
    });
    return;
  }

  const balanceDue = isBalancePayment ? 0 : Math.max(0, order.total - amountReceived);
  const paymentStatus = balanceDue > 0 ? 'deposit_paid' : 'paid';
  const updated = await Order.findOneAndUpdate(
    {
      _id: order._id,
      paymentStatus: isBalancePayment ? 'deposit_paid' : { $in: ['pending', 'failed'] },
      ...(isBalancePayment ? { balanceDue: amountReceived } : {}),
    },
    {
      $set: {
        ...(isBalancePayment ? {} : { paymentIntentId: session.payment_intent }),
        paymentStatus,
        balanceDue,
        ...(isBalancePayment ? {} : { status: 'confirmed' }),
      },
      $push: {
        paymentTransactions: { paymentIntentId: session.payment_intent, amount: amountReceived },
        ...(!isBalancePayment ? {
          statusHistory: {
            status: 'confirmed',
            note: balanceDue > 0
              ? `Deposit of $${amountReceived.toFixed(2)} received; $${balanceDue.toFixed(2)} remains due before dispatch.`
              : 'Payment confirmed by Stripe.',
            at: new Date(),
          },
        } : {}),
      },
      $inc: { balancePaid: amountReceived },
    },
    { new: true }
  );
  if (!updated && !(await Order.exists({ _id: order._id, paymentStatus: { $in: ['paid', 'deposit_paid'] } }))) {
    throw new Error(`Order ${order.orderNumber} could not be marked paid.`);
  }
  if (updated) {
    await enqueueOrderEmail(updated, isBalancePayment ? 'balance_paid' : 'confirmed', {
      note: isBalancePayment
        ? 'Your remaining order balance has been paid.'
        : balanceDue > 0
          ? `Your deposit of $${amountReceived.toFixed(2)} is confirmed. The remaining $${balanceDue.toFixed(2)} is due before dispatch.`
          : 'Your payment is confirmed and the order is being prepared.',
    });
  }
}

async function handleStripeWebhook(req, res, next) {
  try {
    if (!verifyStripeSignature(req.body, req.get('stripe-signature'))) {
      return next(createError(400, 'Invalid Stripe webhook signature.'));
    }
    let event;
    try {
      event = JSON.parse(req.body.toString('utf8'));
    } catch {
      return next(createError(400, 'Invalid Stripe webhook payload.'));
    }
    if (!event.id || !event.type || !event.data?.object) {
      return next(createError(400, 'Stripe webhook event is incomplete.'));
    }

    try {
      await PaymentWebhookEvent.create({ eventId: event.id, type: event.type, status: 'processing' });
    } catch (err) {
      if (err.code !== 11000) throw err;
      const existing = await PaymentWebhookEvent.findOne({ eventId: event.id });
      if (existing?.status === 'processed') return res.json({ received: true, duplicate: true });
    }

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      await updatePaidOrder(event.data.object);
    } else if (event.type === 'checkout.session.expired') {
      const orderId = event.data.object.metadata?.orderId;
      if (orderId) {
        const order = await Order.findOneAndUpdate(
          { _id: orderId, paymentStatus: 'pending' },
          { $set: { paymentStatus: 'failed' } },
          { new: true }
        );
        if (order) await enqueueOrderEmail(order, 'payment_failed', {
          note: 'The hosted payment session expired before payment completed. Please contact us or place a new order.',
          dedupeKey: event.id,
        });
      }
    } else if (event.type === 'payment_intent.payment_failed') {
      const orderId = event.data.object.metadata?.orderId;
      if (orderId) {
        const order = await Order.findOneAndUpdate(
          { _id: orderId, paymentStatus: 'pending' },
          { $set: { paymentStatus: 'failed' } },
          { new: true }
        );
        if (order) await enqueueOrderEmail(order, 'payment_failed', {
          note: 'Payment could not be completed. Please try again or contact our team for help.',
          dedupeKey: event.id,
        });
      }
    } else if (event.type === 'charge.refunded') {
      const charge = event.data.object;
      const order = await Order.findOne({
        $or: [
          { paymentIntentId: charge.payment_intent },
          { 'paymentTransactions.paymentIntentId': charge.payment_intent },
        ],
      });
      if (order) {
      const transaction = order.paymentTransactions.find((entry) => entry.paymentIntentId === charge.payment_intent);
      if (transaction) {
        transaction.refundedAmount = (Number(charge.amount_refunded) || 0) / 100;
        order.refundAmount = order.paymentTransactions.reduce((sum, entry) => sum + entry.refundedAmount, 0);
      } else {
        order.refundAmount = (Number(charge.amount_refunded) || 0) / 100;
      }
      order.paymentStatus = order.refundAmount >= order.total ? 'fully_refunded' : 'partially_refunded';
      if (order.paymentStatus === 'fully_refunded') {
        order.status = 'refunded';
        order.refundedAt = new Date();
      }
      await order.save();
      }
    }

    await PaymentWebhookEvent.updateOne(
      { eventId: event.id },
      { $set: { status: 'processed', processedAt: new Date() } }
    );
    res.json({ received: true });
  } catch (err) {
    next(err);
  }
}

async function getCheckoutSessionStatus(req, res, next) {
  try {
    const session = await stripe.retrieveCheckoutSession(req.params.sessionId);
    if (session.payment_status !== 'paid' || !session.metadata?.orderId) {
      return res.json({ success: true, data: { paid: false } });
    }
    const order = await Order.findById(session.metadata.orderId)
      .select('orderNumber total currency paymentStatus balanceDue tax shippingCost items.product items.productName items.variantName items.sku items.quantity items.unitPrice')
      .lean();
    if (!order) return next(createError(404, 'Order not found.'));
    res.json({
      success: true,
      data: {
        paid: true,
        orderNumber: order.orderNumber,
        total: order.total,
        currency: order.currency,
        paymentStatus: order.paymentStatus,
        balanceDue: order.balanceDue,
        tax: order.tax || 0,
        shipping: order.shippingCost || 0,
        items: (order.items || []).map((item) => ({
          productId: item.product ? String(item.product) : undefined,
          itemName: item.productName || '',
          itemVariant: item.variantName || '',
          itemSku: item.sku || '',
          quantity: item.quantity,
          price: item.unitPrice || 0,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { verifyStripeSignature, handleStripeWebhook, getCheckoutSessionStatus };
