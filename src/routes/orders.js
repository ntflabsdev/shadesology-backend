'use strict';

/**
 * Customer-facing orders router — /api/orders
 *
 * Logged-in users can view their own orders.
 * Guest users can look up by email + order number.
 */

const express  = require('express');
const Order    = require('../models/Order');
const { authenticate } = require('../middlewares/authenticate');
const { createError } = require('../middlewares/errorHandler');
const rateLimit = require('../middlewares/rateLimit');
const { enqueueOrderEmail } = require('../services/orderNotifications');
const { evaluateCustomerRequest } = require('../services/orderPolicy');
const { normalizeOrderForResponse } = require('../services/orderFormatting');

const router = express.Router();

// ─── GET /api/orders — Current user's orders ─────────────────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [orders, total] = await Promise.all([
      Order.find({ user: req.user._id })
        .select('orderNumber status total currency createdAt items shippingAddress statusHistory trackingNumber trackingUrl carrierName estimatedDeliveryDate paymentStatus balanceDue customerRequests')
        .sort('-createdAt')
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Order.countDocuments({ user: req.user._id }),
    ]);

    res.json({
      success: true,
      data:    orders.map(normalizeOrderForResponse),
      meta:    { total, page: parseInt(page), limit: parseInt(limit) },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/orders/:id — Single order (user must own it) ──────────────────
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const order = await Order.findOne({
      _id:  req.params.id,
      user: req.user._id,
    })
      .populate('items.product', 'name slug images')
      .populate('items.variant', 'name sku')
      .lean();

    if (!order) {
      return next(createError(404, 'Order not found.'));
    }
    res.json({ success: true, data: normalizeOrderForResponse(order) });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/orders/lookup — Guest order lookup by email + order number ────
router.post(
  '/lookup',
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'rl:order-lookup' }),
  async (req, res, next) => {
    try {
      const { email, orderNumber } = req.body;
      if (!email || !orderNumber) {
        return next(createError(400, 'email and orderNumber are required.'));
      }

      const order = await Order.findOne({
        orderNumber:  orderNumber.trim().toUpperCase(),
        guestEmail:   email.trim().toLowerCase(),
      })
        .select('orderNumber status total currency createdAt items shippingAddress statusHistory trackingNumber trackingUrl carrierName estimatedDeliveryDate paymentStatus balanceDue customerRequests')
        .lean();

      if (!order) {
        return next(createError(404, 'Order not found. Please check your email and order number.'));
      }
      res.json({ success: true, data: normalizeOrderForResponse(order) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/lookup/requests',
  rateLimit({ windowMs: 60_000, max: 8, keyPrefix: 'rl:guest-order-request' }),
  async (req, res, next) => {
    try {
      const { email, orderNumber, type, reason } = req.body;
      if (!email || !orderNumber || !['cancellation', 'return'].includes(type)) {
        return next(createError(400, 'email, orderNumber, and a valid request type are required.'));
      }
      if (typeof reason !== 'string' || reason.trim().length < 10 || reason.trim().length > 1000) {
        return next(createError(400, 'Please provide a reason between 10 and 1000 characters.'));
      }
      const order = await Order.findOne({
        orderNumber: orderNumber.trim().toUpperCase(),
        guestEmail: email.trim().toLowerCase(),
      });
      if (!order) {
        return next(createError(404, 'Order not found. Please check the order number and email.'));
      }
      const pendingRequest = order.customerRequests.find((request) => request.type === type && request.status === 'pending');
      if (pendingRequest) {
        await enqueueOrderEmail(order, `${type}_request`, {
          note: 'Our team will review your request and contact you with the next steps.',
          dedupeKey: pendingRequest._id.toString(),
        });
        return res.json({
          success: true,
          data: pendingRequest,
          duplicate: true,
          policyNotice: 'Your request is already pending staff review.',
        });
      }
      const policy = evaluateCustomerRequest(order, type);
      if (!policy.allowed) {
        return next(createError(409, policy.message));
      }
      order.customerRequests.push({
        type,
        reason: reason.trim(),
        itemAvailability: policy.availability,
      });
      await order.save();
      const request = order.customerRequests[order.customerRequests.length - 1];
      await enqueueOrderEmail(order, `${type}_request`, {
        note: 'Our team will review your request and contact you with the next steps.',
        dedupeKey: request._id.toString(),
      });
      res.status(201).json({ success: true, data: request, policyNotice: policy.policyNotice });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/requests',
  authenticate,
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'rl:order-request' }),
  async (req, res, next) => {
    try {
      const { type, reason } = req.body;
      if (!['cancellation', 'return'].includes(type)) {
        return next(createError(400, 'Request type must be cancellation or return.'));
      }
      if (typeof reason !== 'string' || reason.trim().length < 10 || reason.trim().length > 1000) {
        return next(createError(400, 'Please provide a reason between 10 and 1000 characters.'));
      }

      const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
      if (!order) {
        return next(createError(404, 'Order not found.'));
      }
      const pendingRequest = order.customerRequests.find((request) => request.type === type && request.status === 'pending');
      if (pendingRequest) {
        await enqueueOrderEmail(order, `${type}_request`, {
          note: 'Our team will review your request and contact you with the next steps.',
          dedupeKey: pendingRequest._id.toString(),
        });
        return res.json({
          success: true,
          data: pendingRequest,
          duplicate: true,
          policyNotice: 'Your request is already pending staff review.',
        });
      }

      const policy = evaluateCustomerRequest(order, type);
      if (!policy.allowed) {
        return next(createError(409, policy.message));
      }

      const request = {
        type,
        reason: reason.trim(),
        itemAvailability: policy.availability,
        status: 'pending',
        createdAt: new Date(),
      };
      order.customerRequests.push(request);
      await order.save();
      await enqueueOrderEmail(order, `${type}_request`, {
        note: 'Our team will review your request and contact you with the next steps.',
        dedupeKey: order.customerRequests[order.customerRequests.length - 1]._id.toString(),
      });
      res.status(201).json({
        success: true,
        data: order.customerRequests[order.customerRequests.length - 1],
        policyNotice: policy.policyNotice,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
