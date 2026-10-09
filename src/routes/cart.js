'use strict';

const express = require('express');
const { optionalAuthenticate, authenticate } = require('../middlewares/authenticate');
const rateLimit = require('../middlewares/rateLimit');
const {
  getCart,
  addItem,
  updateItem,
  removeItem,
  clearCart,
  beginCheckout,
  createCheckoutQuote,
  applyCoupon,
  removeCoupon,
  placeOrder,
  mergeGuestCart,
} = require('../controllers/cart/cartController');

const router = express.Router();

// All cart routes use optionalAuthenticate — works for both guest and logged-in users
router.use(optionalAuthenticate);

// ─── Cart CRUD ────────────────────────────────────────────────────────────────
router.get('/',              getCart);
router.post('/items',        rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'rl:cart-add' }), addItem);
router.patch('/items/:itemId',  updateItem);
router.delete('/items/:itemId', removeItem);
router.delete('/',           clearCart);

// ─── Coupon codes ─────────────────────────────────────────────────────────────
router.post('/coupon',           rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'rl:coupon' }), applyCoupon);
router.delete('/coupon/:code',   removeCoupon);

// ─── Checkout flow ────────────────────────────────────────────────────────────
router.post('/checkout',     rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'rl:checkout' }), beginCheckout);
router.post('/checkout-options', rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'rl:checkout-options' }), createCheckoutQuote);
router.post('/place-order',  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'rl:place-order' }), placeOrder);

// ─── Cart merge after login (requires auth) ───────────────────────────────────
router.post('/merge', authenticate, mergeGuestCart);

module.exports = router;
