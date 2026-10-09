'use strict';

/**
 * Cart controller.
 *
 * Guest carts are identified by a `cart_id` UUID cookie.
 * Registered user carts are linked to user._id.
 * Prices are NEVER stored in the cart — always resolved fresh at view time.
 */

const { createHash, randomUUID } = require('node:crypto');
const Cart      = require('../../models/Cart');
const Order     = require('../../models/Order');
const Company   = require('../../models/Company');
const CheckoutQuote = require('../../models/CheckoutQuote');
const Promotion = require('../../models/Promotion');
const Product   = require('../../models/Product');
const Variant   = require('../../models/Variant');
const { createError } = require('../../middlewares/errorHandler');
const hubspot = require('../../services/hubspot');
const pricing = require('@shadesology/pricing');
const shippingService = require('../../services/shipping');
const taxService = require('../../services/tax');
const stripe = require('../../services/payments/stripe');
const { enqueueOrderEmail } = require('../../services/orderNotifications');
const { resolvePricingUser } = require('../../services/commercialPricing');

const CART_COOKIE = 'shades_cart';
const COOKIE_MAX_AGE = 90 * 24 * 60 * 60 * 1000; // 90 days

// ─── Resolve cart (user or guest) ─────────────────────────────────────────────
async function resolveCart(req, res) {
  if (req.user) {
    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) cart = await Cart.create({ user: req.user._id });
    return cart;
  }

  let guestId = req.cookies[CART_COOKIE];
  if (!guestId) {
    guestId = randomUUID();
    res.cookie(CART_COOKIE, guestId, {
      httpOnly: true,
      maxAge:   COOKIE_MAX_AGE,
      sameSite: 'lax',
      secure:   process.env.NODE_ENV === 'production',
    });
  }

  let cart = await Cart.findOne({ guestId });
  if (!cart) cart = await Cart.create({ guestId });
  return cart;
}

// ─── Enrich cart items with live product/variant data + pricing ────────────────
async function enrichItems(items, user) {
  const pricingUser = await resolvePricingUser(user);
  return Promise.all(
    items.map(async (item) => {
      const [product, variant] = await Promise.all([
        Product.findById(item.product).select('name slug images showPrice isActive').lean(),
        Variant.findById(item.variant).select(
          'name sku basePrice priceTiers availability leadTimeDays isActive freightClass shippingLengthIn shippingWidthIn shippingHeightIn shippingWeightLbs requiresCrating specialHandlingCharges'
        ).lean(),
      ]);

      if (!product || !variant) return null; // orphaned item — skip

      // Build selectedOptions array for pricing engine
      const optsArray = [];
      if (item.selectedOptions && typeof item.selectedOptions === 'object') {
        const optsMap = item.selectedOptions instanceof Map
          ? Object.fromEntries(item.selectedOptions)
          : item.selectedOptions;

        for (const [, optVal] of Object.entries(optsMap)) {
          if (optVal && typeof optVal === 'object') {
            optsArray.push({
              name:             optVal.name || '',
              surchargeType:    optVal.surchargeType || 'none',
              surchargeAmount:  optVal.surchargeAmount || 0,
            });
          }
        }
      }

      // Calculate current live price
      const breakdown = pricing.calculateLinePrice({
        basePrice:  variant.basePrice,
        priceTiers: variant.priceTiers || [],
        user: pricingUser,
        selectedOptions: optsArray,
        quantity: item.quantity,
      });

      // Detect price change since add-to-cart
      const priceChanged = item.snapshotPrice != null &&
        Math.abs(item.snapshotPrice - breakdown.unitPrice) > 0.01;

      return {
        _id:      item._id,
        product:  { _id: product._id, name: product.name, slug: product.slug, image: product.images?.[0] },
        variant:  { _id: variant._id, name: variant.name, sku: variant.sku, availability: variant.availability, leadTimeDays: variant.leadTimeDays },
        quantity: item.quantity,
        selectedOptions: item.selectedOptions,
        pricing:  {
          displayPrice:   breakdown.displayPrice,
          priceType:      breakdown.priceType,
          surcharges:     breakdown.surcharges,
          totalSurcharge: breakdown.totalSurcharge,
          unitPrice:      breakdown.unitPrice,
          lineTotal:      breakdown.lineTotal,
        },
        priceChanged,
        isAvailable: product.isActive && variant.isActive && variant.availability !== 'discontinued',
      };
    })
  ).then((items) => items.filter(Boolean));
}

// ─── Resolve active promotions for the cart's coupon codes ───────────────────
async function resolvePromos(couponCodes = []) {
  if (!couponCodes.length) return [];
  return Promotion.find({
    code:   { $in: couponCodes.map((c) => c.toUpperCase()) },
    active: true,
    $or: [{ startDate: null }, { startDate: { $lte: new Date() } }],
  }).lean();
}

// ─── GET /api/cart ─────────────────────────────────────────────────────────────
const getCart = async (req, res, next) => {
  try {
    const cart  = await resolveCart(req, res);
    const items = await enrichItems(cart.items, req.user || null);
    const promos = await resolvePromos(cart.couponCodes);

    const orderTotals = pricing.calculateOrderTotals(
      items.map((i) => ({ lineTotal: i.pricing.lineTotal, productId: i.product._id })),
      promos
    );

    res.json({
      success: true,
      data: {
        _id:   cart._id,
        items,
        totals: orderTotals,
        couponCodes: cart.couponCodes,
        itemCount:   items.reduce((s, i) => s + i.quantity, 0),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/cart/items — Add item ──────────────────────────────────────────
const addItem = async (req, res, next) => {
  try {
    const { productId, variantId, quantity = 1, selectedOptions = {} } = req.body;

    if (!productId || !variantId) {
      return next(createError(400, 'productId and variantId are required.'));
    }
    if (quantity < 1 || !Number.isInteger(quantity)) {
      return next(createError(400, 'quantity must be a positive integer.'));
    }

    const [product, variant] = await Promise.all([
      Product.findById(productId).select('isActive showPrice').lean(),
      Variant.findById(variantId).select('basePrice priceTiers isActive availability product').lean(),
    ]);

    if (!product || !product.isActive) return next(createError(404, 'Product not found.'));
    if (!variant || !variant.isActive) return next(createError(404, 'Variant not found.'));
    if (String(variant.product) !== String(productId)) {
      return next(createError(400, 'Variant does not belong to this product.'));
    }

    // Calculate and snapshot the current unit price
    const pricingUser = await resolvePricingUser(req.user || null);
    const breakdown = pricing.calculateLinePrice({
      basePrice:  variant.basePrice,
      priceTiers: variant.priceTiers || [],
      user:       pricingUser,
      quantity:   1,
    });

    const cart = await resolveCart(req, res);

    // Merge with existing line if same variant + same options
    const existingIdx = cart.items.findIndex(
      (i) =>
        String(i.variant) === String(variantId) &&
        JSON.stringify(i.selectedOptions) === JSON.stringify(selectedOptions)
    );

    if (existingIdx >= 0) {
      cart.items[existingIdx].quantity += quantity;
      cart.items[existingIdx].snapshotPrice = breakdown.unitPrice;
    } else {
      cart.items.push({
        product:         productId,
        variant:         variantId,
        quantity,
        selectedOptions,
        snapshotPrice:   breakdown.unitPrice,
      });
    }

    await cart.save();

    res.json({ success: true, message: 'Item added to cart.', itemCount: cart.items.length });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/cart/items/:itemId — Update quantity ──────────────────────────
const updateItem = async (req, res, next) => {
  try {
    const { quantity } = req.body;
    if (!Number.isInteger(quantity) || quantity < 0) {
      return next(createError(400, 'quantity must be a non-negative integer.'));
    }

    const cart = await resolveCart(req, res);
    const idx  = cart.items.findIndex((i) => String(i._id) === req.params.itemId);
    if (idx < 0) return next(createError(404, 'Cart item not found.'));

    if (quantity === 0) {
      cart.items.splice(idx, 1);
    } else {
      cart.items[idx].quantity = quantity;
    }

    await cart.save();
    res.json({ success: true, message: quantity === 0 ? 'Item removed.' : 'Quantity updated.' });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/cart/items/:itemId — Remove item ────────────────────────────
const removeItem = async (req, res, next) => {
  try {
    const cart = await resolveCart(req, res);
    const before = cart.items.length;
    cart.items   = cart.items.filter((i) => String(i._id) !== req.params.itemId);
    if (cart.items.length === before) return next(createError(404, 'Cart item not found.'));
    await cart.save();
    res.json({ success: true, message: 'Item removed from cart.' });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/cart — Clear cart ───────────────────────────────────────────
const clearCart = async (req, res, next) => {
  try {
    const cart  = await resolveCart(req, res);
    cart.items  = [];
    cart.couponCodes = [];
    await cart.save();
    res.json({ success: true, message: 'Cart cleared.' });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/cart/checkout — Validate + begin checkout ─────────────────────
const beginCheckout = async (req, res, next) => {
  try {
    const { email, firstName, lastName } = req.body;

    const cart  = await resolveCart(req, res);
    if (!cart.items.length) return next(createError(400, 'Your cart is empty.'));

    // Re-validate all prices against live data
    const items = await enrichItems(cart.items, req.user || null);
    if (items.some((item) => !item)) return next(createError(422, 'A cart item is no longer available.'));
    const priceChanges = items.filter((i) => i.priceChanged);

    // Record checkout start + contact for abandoned-cart recovery
    if (email) {
      cart.contactEmail   = email.toLowerCase().trim();
      cart.contactName    = `${firstName || ''} ${lastName || ''}`.trim();
      cart.checkoutStartedAt = new Date();
      await cart.save();
      await hubspot.enqueueSync('cart', cart._id.toString(), { delay: 60 * 60 * 1000 });
    }

    const promos = await resolvePromos(cart.couponCodes);
    const orderTotals = pricing.calculateOrderTotals(
      items.map((i) => ({ lineTotal: i.pricing.lineTotal, productId: i.product._id })),
      promos
    );

    res.json({
      success: true,
      data: {
        items,
        totals:        orderTotals,
        couponCodes:   cart.couponCodes,
        priceChanges:  priceChanges.map((i) => ({
          itemId:    i._id,
          variantName: i.variant.name,
          oldPrice:  i.snapshotPrice,
          newPrice:  i.pricing.unitPrice,
        })),
        hasPriceChanges: priceChanges.length > 0,
      },
    });
  } catch (err) {
    next(err);
  }
};

const createCheckoutQuote = async (req, res, next) => {
  try {
    const { contact, shipping } = req.body;
    if (!shipping?.line1 || !shipping?.city || !shipping?.state || !shipping?.zip) {
      return next(createError(400, 'A complete shipping address is required.'));
    }
    const cart = await resolveCart(req, res);
    if (!cart.items.length) return next(createError(400, 'Your cart is empty.'));

    const items = await enrichItems(cart.items, req.user || null);
    if (items.some((item) => !item)) return next(createError(422, 'A cart item is no longer available.'));
    if (items.some((item) => !item.isAvailable)) return next(createError(422, 'A cart item is not currently available.'));
    const promos = await resolvePromos(cart.couponCodes);
    const orderTotals = pricing.calculateOrderTotals(
      items.map((item) => ({ lineTotal: item.pricing.lineTotal, productId: item.product._id })),
      promos
    );
    const address = {
      firstName: contact?.firstName || '',
      lastName: contact?.lastName || '',
      line1: shipping.line1.trim(),
      line2: (shipping.line2 || '').trim(),
      city: shipping.city.trim(),
      state: shipping.state.trim().toUpperCase(),
      zip: shipping.zip.trim(),
      country: (shipping.country || 'US').trim().toUpperCase(),
      phone: contact?.phone || '',
    };
    const shippingOption = await shippingService.getShippingOption({
      address,
      items,
      subtotal: orderTotals.orderSubtotal,
    });
    if (shippingOption.quoteRequired) {
      return res.status(200).json({
        success: true,
        data: {
          quoteRequired: true,
          reason: shippingOption.reason,
          quoteUrl: '/quote/basket',
        },
      });
    }

    const tax = await taxService.calculateTax({
      address,
      subtotal: orderTotals.orderSubtotal,
      shipping: shippingOption.cost,
    });
    const total = orderTotals.orderSubtotal + shippingOption.cost + tax.amount;
    if (!Number.isFinite(total) || total <= 0 || Math.round(total * 100) !== total * 100) {
      return next(createError(422, 'Checkout total is invalid.'));
    }

    const fingerprintData = {
      cart: cart.items.map((item, index) => ({
        id: item._id.toString(),
        quantity: item.quantity,
        unitPrice: items[index].pricing.unitPrice,
        selectedOptions: item.selectedOptions?.toObject?.() || item.selectedOptions || {},
      })),
      subtotal: orderTotals.orderSubtotal,
      discount: orderTotals.orderDiscount,
      address,
    };
    const fingerprint = createHash('sha256').update(JSON.stringify(fingerprintData)).digest('hex');
    const token = randomUUID();
    const checkoutQuote = await CheckoutQuote.create({
      token,
      cartId: cart._id,
      fingerprint,
      shippingAddress: address,
      selectedShipping: {
        rateRuleId: shippingOption.rateRuleId,
        carrierRateId: shippingOption.carrierRateId,
        carrierName: shippingOption.carrierName,
        label: shippingOption.label,
        cost: shippingOption.cost,
        charges: shippingOption.charges,
        productionDays: shippingOption.productionDays,
        transitDays: shippingOption.transitDays,
        estimatedDeliveryDate: shippingOption.estimatedDeliveryDate,
      },
      subtotal: orderTotals.orderSubtotal,
      discountAmount: orderTotals.orderDiscount,
      tax: tax.amount,
      taxRate: tax.rate,
      total,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    res.json({
      success: true,
      data: {
        checkoutToken: checkoutQuote.token,
        quoteRequired: false,
        subtotal: checkoutQuote.subtotal,
        discountAmount: checkoutQuote.discountAmount,
        shipping: checkoutQuote.selectedShipping,
        tax: checkoutQuote.tax,
        taxRate: checkoutQuote.taxRate,
        total: checkoutQuote.total,
        currency: 'USD',
        expiresAt: checkoutQuote.expiresAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/cart/coupon — Apply a coupon code ──────────────────────────────
const applyCoupon = async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return next(createError(400, 'code is required.'));
    }

    const now = new Date();
    const promo = await Promotion.findOne({
      code:   code.trim().toUpperCase(),
      active: true,
      $and: [
        { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: null },   { endDate:   { $gte: now } }] },
      ],
    });

    if (!promo) {
      return next(createError(404, 'Coupon code not found or expired.'));
    }

    // Check usage limit
    if (promo.maxUses != null && promo.usedCount >= promo.maxUses) {
      return next(createError(422, 'This coupon has reached its usage limit.'));
    }

    const cart = await resolveCart(req, res);

    // Prevent duplicate application
    if (cart.couponCodes.includes(promo.code)) {
      return next(createError(409, 'This coupon is already applied.'));
    }

    // Check minimum order amount
    if (promo.minimumOrderAmount > 0) {
      const enriched = await enrichItems(cart.items, req.user || null);
      const subtotal  = enriched.reduce((s, i) => s + i.pricing.lineTotal, 0);
      if (subtotal < promo.minimumOrderAmount) {
        return next(createError(422, `This coupon requires a minimum order of $${promo.minimumOrderAmount}.`));
      }
    }

    cart.couponCodes.push(promo.code);
    await cart.save();

    res.json({
      success: true,
      message: `Coupon "${promo.code}" applied.`,
      coupon:  { code: promo.code, type: promo.type, value: promo.value, name: promo.name },
    });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/cart/coupon/:code — Remove a coupon code ────────────────────
const removeCoupon = async (req, res, next) => {
  try {
    const code = req.params.code?.toUpperCase();
    const cart = await resolveCart(req, res);

    const idx = cart.couponCodes.indexOf(code);
    if (idx < 0) return next(createError(404, 'Coupon not found in cart.'));

    cart.couponCodes.splice(idx, 1);
    await cart.save();

    res.json({ success: true, message: `Coupon "${code}" removed.` });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/cart/place-order — Create Order from cart ─────────────────────
/**
 * Creates an Order record from the current cart.
 *
 * Payment is NOT processed here — that is Prompt 1.14 (Stripe).
 * This endpoint:
 *   1. Re-validates all prices (catches any change between beginCheckout + now)
 *   2. Checks availability
 *   3. Creates a locked-price Order document
 *   4. Records CRM sync state and queues the order for HubSpot
 *   5. Clears the cart
 *   6. Returns the order number + order id
 */
const placeOrder = async (req, res, next) => {
  let reservedCompanyId = null;
  let reservedCredit = 0;
  let creditOrderCreated = false;
  try {
    const {
      contact,          // { firstName, lastName, email, phone }
      shipping,         // { line1, line2, city, state, zip, country }
      billing,          // optional, same shape as shipping
      sameAsBilling = true,
      checkoutToken,
      paymentMethod = 'card',
      paymentPlan = 'full',
      purchaseOrderNumber = '',
    } = req.body;

    // ── Validate required fields ────────────────────────────────────────────
    if (!contact?.email || !contact?.firstName || !contact?.lastName) {
      return next(createError(400, 'contact.email, firstName and lastName are required.'));
    }
    if (!shipping?.line1 || !shipping?.city || !shipping?.state || !shipping?.zip) {
      return next(createError(400, 'Shipping address is incomplete.'));
    }
    if (!checkoutToken || !['card', 'bank_transfer', 'purchase_order'].includes(paymentMethod)) {
      return next(createError(400, 'A valid checkout quote and payment method are required.'));
    }
    if (!['full', 'deposit'].includes(paymentPlan)) {
      return next(createError(400, 'paymentPlan must be "full" or "deposit".'));
    }
    if (paymentMethod === 'purchase_order' && (
      paymentPlan !== 'full' ||
      typeof purchaseOrderNumber !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9 _./-]{0,99}$/.test(purchaseOrderNumber.trim())
    )) {
      return next(createError(400, 'Purchase order checkout requires a valid PO reference and full payment plan.'));
    }
    const checkoutKey = req.get('Idempotency-Key');
    if (!checkoutKey || !/^[a-zA-Z0-9_-]{16,100}$/.test(checkoutKey)) {
      return next(createError(400, 'A valid Idempotency-Key header is required.'));
    }

    const cart = await resolveCart(req, res);
    const existingOrder = await Order.findOne({ checkoutKey }).lean();
    if (existingOrder) {
      if (['bank_transfer', 'purchase_order'].includes(existingOrder.paymentMethod)) {
        await enqueueOrderEmail(existingOrder, 'received', {
          note: existingOrder.paymentMethod === 'purchase_order'
            ? 'We received your order against the purchase order reference on your company account.'
            : 'We received your order and will begin processing after the bank transfer is confirmed.',
        });
      }
      return res.status(200).json({
        success: true,
        data: {
          orderId: existingOrder._id,
          orderNumber: existingOrder.orderNumber,
          purchaseOrderNumber: existingOrder.purchaseOrderNumber,
          total: existingOrder.total,
          checkoutUrl: existingOrder.paymentCheckoutUrl || null,
          paymentMethod: existingOrder.paymentMethod,
          paymentStatus: existingOrder.paymentStatus,
          amountDueNow: existingOrder.paymentMethod === 'purchase_order' ? 0 : existingOrder.depositAmount || existingOrder.total,
          balanceDue: existingOrder.balanceDue || 0,
          bankTransferInstructions: existingOrder.paymentMethod === 'bank_transfer'
            ? {
                bankName: process.env.BANK_TRANSFER_BANK_NAME || '',
                accountName: process.env.BANK_TRANSFER_ACCOUNT_NAME || '',
                accountNumber: process.env.BANK_TRANSFER_ACCOUNT_NUMBER || '',
                routingNumber: process.env.BANK_TRANSFER_ROUTING_NUMBER || '',
                reference: existingOrder.orderNumber,
              }
            : null,
          priceChanges: [],
        },
      });
    }
    if (!cart.items.length) return next(createError(400, 'Your cart is empty.'));

    // ── Re-validate all prices ──────────────────────────────────────────────
    const items = await enrichItems(cart.items, req.user || null);
    if (items.some((item) => !item)) return next(createError(422, 'A cart item is no longer available.'));

    const unavailableItems = items.filter((i) => !i.isAvailable);
    if (unavailableItems.length) {
      return next(createError(422,
        `Some items are no longer available: ${unavailableItems.map((i) => i.variant.name).join(', ')}`
      ));
    }

    const priceChanges = items.filter((i) => i.priceChanged);

    // ── Resolve promos + order totals ───────────────────────────────────────
    const promos = await resolvePromos(cart.couponCodes);
    const orderTotals = pricing.calculateOrderTotals(
      items.map((i) => ({ lineTotal: i.pricing.lineTotal, productId: i.product._id })),
      promos
    );
    const checkoutQuote = await CheckoutQuote.findOne({
      token: checkoutToken,
      cartId: cart._id,
      expiresAt: { $gt: new Date() },
    });
    if (!checkoutQuote) return next(createError(409, 'Your shipping quote expired. Please recalculate shipping and tax.'));
    const addressForQuote = {
      firstName: contact.firstName,
      lastName: contact.lastName,
      line1: shipping.line1.trim(),
      line2: (shipping.line2 || '').trim(),
      city: shipping.city.trim(),
      state: shipping.state.trim().toUpperCase(),
      zip: shipping.zip.trim(),
      country: (shipping.country || 'US').trim().toUpperCase(),
      phone: contact.phone || '',
    };
    const fingerprintData = {
      cart: cart.items.map((item, index) => ({
        id: item._id.toString(),
        quantity: item.quantity,
        unitPrice: items[index].pricing.unitPrice,
        selectedOptions: item.selectedOptions?.toObject?.() || item.selectedOptions || {},
      })),
      subtotal: orderTotals.orderSubtotal,
      discount: orderTotals.orderDiscount,
      address: addressForQuote,
    };
    const fingerprint = createHash('sha256').update(JSON.stringify(fingerprintData)).digest('hex');
    if (fingerprint !== checkoutQuote.fingerprint) {
      return next(createError(409, 'Cart or delivery address changed. Recalculate shipping and tax before placing the order.'));
    }
    const depositPercent = Number(process.env.DEPOSIT_PERCENT || 30);
    if (!Number.isFinite(depositPercent) || depositPercent < 1 || depositPercent > 100) {
      return next(createError(500, 'DEPOSIT_PERCENT must be between 1 and 100.'));
    }

    // ── Build order lines with locked pricing ───────────────────────────────
    const orderLines = items.map((i) => ({
      product:     i.product._id,
      variant:     i.variant._id,
      productName: i.product.name?.en || '',
      variantName: i.variant.name?.en || i.variant.name || '',
      sku:         i.variant.sku,
      quantity:    i.quantity,
      availability: i.variant.availability || 'made_to_order',
      selectedOptions: i.selectedOptions,
      unitPrice:       i.pricing.unitPrice,
      // map 'type' → 'kind' to avoid Mongoose reserved-word conflict in sub-schema
      surcharges:  (i.pricing.surcharges || []).map((s) => ({
        label:  s.label,
        kind:   s.type,
        amount: s.amount,
      })),
      totalSurcharge:  i.pricing.totalSurcharge,
      lineTotal:       i.pricing.lineTotal,
      priceType:       i.pricing.priceType,
    }));

    const shippingAddress = {
      firstName: contact.firstName,
      lastName:  contact.lastName,
      line1:     shipping.line1,
      line2:     shipping.line2 || '',
      city:      shipping.city,
      state:     shipping.state,
      zip:       shipping.zip,
      country:   shipping.country || 'US',
      phone:     contact.phone || '',
    };

    const billingAddress = sameAsBilling
      ? { ...shippingAddress }
      : {
          firstName: billing?.firstName || contact.firstName,
          lastName:  billing?.lastName  || contact.lastName,
          line1:     billing?.line1  || '',
          line2:     billing?.line2  || '',
          city:      billing?.city   || '',
          state:     billing?.state  || '',
          zip:       billing?.zip    || '',
          country:   billing?.country || 'US',
          phone:     contact.phone || '',
        };

    let company = null;
    if (paymentMethod === 'purchase_order') {
      if (!req.user || req.user.role !== 'dealer' || !req.user.company) {
        return next(createError(403, 'Purchase order checkout is available only to approved dealer accounts.'));
      }
      company = await Company.findOne({
        _id: req.user.company,
        type: 'dealer',
        isActive: true,
        isApproved: true,
        paymentTerms: { $in: ['net15', 'net30', 'net45', 'net60'] },
      }).select('creditLimit pendingBalance');
      if (!company || !Number.isFinite(company.creditLimit) || company.creditLimit <= 0) {
        return next(createError(403, 'Your dealer account does not have active purchase-order terms.'));
      }
      const reservation = await Company.updateOne(
        {
          _id: company._id,
          isActive: true,
          isApproved: true,
          $expr: {
            $lte: [
              { $add: [{ $ifNull: ['$pendingBalance', 0] }, checkoutQuote.total] },
              '$creditLimit',
            ],
          },
        },
        { $inc: { pendingBalance: checkoutQuote.total } },
      );
      if (reservation.modifiedCount !== 1) {
        return next(createError(409, 'This order exceeds your company credit limit. Contact your account manager.'));
      }
      reservedCompanyId = company._id;
      reservedCredit = checkoutQuote.total;
    }

    // ── Create the order ────────────────────────────────────────────────────
    const order = await Order.create({
      user:        req.user?._id || null,
      company:     req.user?.company || null,
      purchaseOrderNumber: paymentMethod === 'purchase_order' ? purchaseOrderNumber.trim() : '',
      guestEmail:  req.user ? null : contact.email.toLowerCase().trim(),
      guestName:   req.user ? null : `${contact.firstName} ${contact.lastName}`.trim(),
      isGuest:     !req.user,
      items:       orderLines,
      shippingAddress,
      billingAddress,
      sameAsBilling,
      subtotal:        orderTotals.orderSubtotal,
      discountAmount:  orderTotals.orderDiscount,
      couponCodes:     cart.couponCodes,
      shippingCost:    checkoutQuote.selectedShipping.cost,
      shippingLabel:   checkoutQuote.selectedShipping.label,
      shippingCharges: checkoutQuote.selectedShipping.charges,
      shippingRateRuleId: checkoutQuote.selectedShipping.rateRuleId,
      carrierRateId: checkoutQuote.selectedShipping.carrierRateId,
      estimatedDeliveryDate: checkoutQuote.selectedShipping.estimatedDeliveryDate,
      tax:             checkoutQuote.tax,
      taxRate:         checkoutQuote.taxRate,
      total:           checkoutQuote.total,
      currency:        'USD',
      paymentMethod:   paymentMethod === 'card' ? 'stripe_checkout' : paymentMethod === 'purchase_order' ? 'purchase_order' : 'bank_transfer',
      paymentStatus:   'pending',
      status:          paymentMethod === 'purchase_order' ? 'confirmed' : 'pending',
      source:          'cart',
      checkoutKey,
      crmSyncStatus:   'pending',
      statusHistory: [{
        status: paymentMethod === 'purchase_order' ? 'confirmed' : 'pending',
        note: paymentMethod === 'card'
          ? 'Order created — awaiting hosted card payment.'
          : paymentMethod === 'purchase_order'
            ? `Dealer purchase order ${purchaseOrderNumber.trim()} accepted against approved company terms.`
            : 'Order created — awaiting bank transfer.',
      }],
    });
    creditOrderCreated = paymentMethod === 'purchase_order';
    const amountToCollect = paymentMethod === 'purchase_order' ? 0 : paymentPlan === 'deposit' && depositPercent < 100
      ? Math.round(order.total * depositPercent) / 100
      : order.total;
    order.depositAmount = amountToCollect;
    order.balanceDue = Math.max(0, order.total - amountToCollect);

    let checkoutUrl = null;
    if (paymentMethod === 'card') {
      try {
        const session = await stripe.createCheckoutSession({
          order,
          customerEmail: contact.email.toLowerCase().trim(),
          amountToCollect,
          successUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/checkout?payment=cancelled`,
          idempotencyKey: `order-${order._id}`,
        });
        checkoutUrl = session.url;
        order.stripeCheckoutSessionId = session.id;
        order.paymentCheckoutUrl = checkoutUrl;
        order.status = 'payment_processing';
        order.statusHistory.push({ status: 'payment_processing', note: 'Waiting for secure payment provider.' });
      } catch (paymentError) {
        await Order.findByIdAndDelete(order._id);
        throw paymentError;
      }
    }
    await order.save();
    await hubspot.enqueueSync('order', order._id.toString());

    // ── Increment promo usage counts ────────────────────────────────────────
    if (cart.couponCodes.length) {
      await Promotion.updateMany(
        { code: { $in: cart.couponCodes } },
        { $inc: { usedCount: 1 } }
      );
    }

    // ── Clear the cart ──────────────────────────────────────────────────────
    cart.items             = [];
    cart.couponCodes       = [];
    cart.checkoutStartedAt = null; // no longer abandoned
    await cart.save();

    if (paymentMethod === 'bank_transfer' || paymentMethod === 'purchase_order') {
      await enqueueOrderEmail(order, 'received', {
        note: paymentMethod === 'purchase_order'
          ? `We received your order against purchase order ${purchaseOrderNumber.trim()}.`
          : 'We received your order and will begin processing after the bank transfer is confirmed.',
      });
    }

    res.status(201).json({
      success: true,
      data: {
        orderId:      order._id,
        orderNumber:  order.orderNumber,
        purchaseOrderNumber: order.purchaseOrderNumber,
        total:        order.total,
        checkoutUrl,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        amountDueNow: amountToCollect,
        balanceDue: order.balanceDue,
        bankTransferInstructions: paymentMethod === 'bank_transfer'
          ? {
              bankName: process.env.BANK_TRANSFER_BANK_NAME || '',
              accountName: process.env.BANK_TRANSFER_ACCOUNT_NAME || '',
              accountNumber: process.env.BANK_TRANSFER_ACCOUNT_NUMBER || '',
              routingNumber: process.env.BANK_TRANSFER_ROUTING_NUMBER || '',
              reference: order.orderNumber,
            }
          : null,
        priceChanges: priceChanges.map((i) => ({
          variantName: i.variant.name,
          oldPrice:    i.snapshotPrice,
          newPrice:    i.pricing.unitPrice,
        })),
      },
    });
  } catch (err) {
    if (reservedCompanyId && !creditOrderCreated) {
      await Company.updateOne({ _id: reservedCompanyId }, { $inc: { pendingBalance: -reservedCredit } });
    }
    if (err.code === 11000 && err.keyPattern?.checkoutKey) {
      const order = await Order.findOne({ checkoutKey: req.get('Idempotency-Key') }).lean();
      if (order) {
        return res.status(200).json({
          success: true,
          data: {
            orderId: order._id,
            orderNumber: order.orderNumber,
            purchaseOrderNumber: order.purchaseOrderNumber,
            total: order.total,
            checkoutUrl: order.paymentCheckoutUrl || null,
            paymentMethod: order.paymentMethod,
            paymentStatus: order.paymentStatus,
            amountDueNow: order.paymentMethod === 'purchase_order' ? 0 : order.depositAmount || order.total,
            balanceDue: order.balanceDue || 0,
            bankTransferInstructions: order.paymentMethod === 'bank_transfer'
              ? {
                  bankName: process.env.BANK_TRANSFER_BANK_NAME || '',
                  accountName: process.env.BANK_TRANSFER_ACCOUNT_NAME || '',
                  accountNumber: process.env.BANK_TRANSFER_ACCOUNT_NUMBER || '',
                  routingNumber: process.env.BANK_TRANSFER_ROUTING_NUMBER || '',
                  reference: order.orderNumber,
                }
              : null,
            priceChanges: [],
          },
        });
      }
    }
    next(err);
  }
};

// ─── POST /api/cart/merge — Merge guest cart into user cart after login ───────
/**
 * Called after a successful login to merge any existing guest cart into
 * the user's own cart. The guest cart cookie is cleared after merge.
 */
const mergeGuestCart = async (req, res, next) => {
  try {
    const guestId = req.cookies[CART_COOKIE];
    if (!guestId || !req.user) {
      return res.json({ success: true, message: 'Nothing to merge.' });
    }

    const [guestCart, userCart] = await Promise.all([
      Cart.findOne({ guestId }),
      Cart.findOne({ user: req.user._id }),
    ]);

    if (!guestCart || !guestCart.items.length) {
      // Still clear the cookie
      if (guestCart) await Cart.deleteOne({ _id: guestCart._id });
      res.clearCookie(CART_COOKIE);
      return res.json({ success: true, message: 'Guest cart is empty.' });
    }

    const targetCart = userCart || (await Cart.create({ user: req.user._id }));

    // Merge: if variant+options match, add quantities; otherwise push new line
    for (const guestItem of guestCart.items) {
      const existingIdx = targetCart.items.findIndex(
        (i) =>
          String(i.variant) === String(guestItem.variant) &&
          JSON.stringify(i.selectedOptions) === JSON.stringify(guestItem.selectedOptions)
      );

      if (existingIdx >= 0) {
        targetCart.items[existingIdx].quantity += guestItem.quantity;
        // Refresh snapshot price to the most recent
        targetCart.items[existingIdx].snapshotPrice = guestItem.snapshotPrice;
      } else {
        const itemObj = guestItem.toObject();
        delete itemObj._id;
        targetCart.items.push(itemObj);
      }
    }

    // Merge coupon codes (deduplicate)
    for (const code of guestCart.couponCodes) {
      if (!targetCart.couponCodes.includes(code)) {
        targetCart.couponCodes.push(code);
      }
    }

    await targetCart.save();

    // Remove the guest cart and clear the cookie
    await Cart.deleteOne({ _id: guestCart._id });
    res.clearCookie(CART_COOKIE);

    res.json({
      success: true,
      message: `${guestCart.items.length} item(s) merged into your cart.`,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
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
};
