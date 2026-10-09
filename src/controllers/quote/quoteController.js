'use strict';

/**
 * Quote controller — public-facing and customer-portal quote flows.
 *
 * Submission order (non-negotiable per spec):
 *   1. Validate
 *   2. Store in DB
 *   3. Enqueue SES emails (autoresponder + staff notification)
 *   4. Enqueue CRM sync
 *
 * A failure at step 3 or 4 MUST NOT lose or block the quote.
 */

const mongoose = require('mongoose');
const Quote   = require('../../models/Quote');
const Order   = require('../../models/Order');
const Product = require('../../models/Product');
const Variant = require('../../models/Variant');
const { createError } = require('../../middlewares/errorHandler');
const { getQueue }    = require('../../queues/index');
const hubspot         = require('../../services/hubspot');
const { enqueueOrderEmail } = require('../../services/orderNotifications');
const { createHash }  = require('node:crypto');
const s3              = require('../../services/s3');
const UserModel       = require('../../models/User');
const { MAX_SIZE_BYTES } = require('../upload/uploadController');
const { resolveLeadRecipient } = require('../../services/leadRouting');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function enqueueEmail(opts) {
  try {
    getQueue('email').add('send', opts, { attempts: 5 }).catch((err) =>
      console.error('[QuoteCtrl] email queue error:', err.message)
    );
  } catch {
    console.warn('[QuoteCtrl] email queue unavailable');
  }
}

// ─── Submit quote ─────────────────────────────────────────────────────────────
const submitQuote = async (req, res, next) => {
  try {
    const {
      items,
      attachments = [],
      guestContact,
      projectDescription,
      installationAddress,
      buildingType,
      segment,
      enquiryQueue,
    } = req.body;

    // 1. Validate
    if (!items || !Array.isArray(items) || items.length === 0) {
      return next(createError(400, 'At least one item is required.'));
    }
    if (!Array.isArray(attachments)) {
      return next(createError(400, 'Attachments must be an array.'));
    }
    if (attachments.length > 20) {
      return next(createError(400, 'A quote can include no more than 20 attachments.'));
    }

    // Determine contact
    const isGuest = !req.user;
    if (isGuest) {
      if (!guestContact?.email || !guestContact?.firstName || !guestContact?.lastName) {
        return next(createError(400, 'firstName, lastName, and email are required for guest quotes.'));
      }
    }

    // Resolve item names for the stored record
    const resolvedItems = await Promise.all(
      items.map(async (item) => {
        const base = {
          quantity:        item.quantity || 1,
          selectedOptions: item.selectedOptions || {},
          notes:           item.notes || '',
        };

        if (item.productId) {
          const product = await Product.findById(item.productId).select('name slug').lean();
          if (product) {
            base.product     = product._id;
            base.productName = product.name?.en || '';
          }
        }
        if (item.variantId) {
          const variant = await Variant.findById(item.variantId).select('name sku').lean();
          if (variant) {
            base.variant     = variant._id;
            base.variantName = variant.name?.en || '';
            base.sku         = variant.sku || '';
          }
        }
        return base;
      })
    );

    const pendingPrefix = `${process.env.NODE_ENV || 'development'}/quotes/pending/`;
    const resolvedAttachments = await Promise.all(attachments.map(async (attachment) => {
      const key = attachment?.s3Key;
      if (
        typeof key !== 'string' ||
        !key.startsWith(pendingPrefix) ||
        !/^[a-f0-9]{12}-[a-z0-9._-]+$/.test(key.slice(pendingPrefix.length))
      ) {
        throw createError(400, 'One or more attachments are invalid.');
      }

      const file = await s3.headFile(key, 'private');
      if (!file.exists) {
        throw createError(400, 'An attachment could not be found in private storage.');
      }
      if (
        !file.contentType ||
        !s3.ALLOWED_TYPES.has(file.contentType) ||
        !Number.isSafeInteger(file.contentLength) ||
        file.contentLength < 1 ||
        file.contentLength > MAX_SIZE_BYTES
      ) {
        throw createError(400, 'An attachment has an unsupported file type or size.');
      }

      const requestedName = typeof attachment.filename === 'string'
        ? attachment.filename
        : key.slice(pendingPrefix.length).replace(/^[a-f0-9]{12}-/, '');

      return {
        s3Key: key,
        filename: s3.sanitiseFilename(requestedName),
        contentType: file.contentType,
        sizeBytes: file.contentLength,
      };
    }));

    if (new Set(resolvedAttachments.map((file) => file.s3Key)).size !== resolvedAttachments.length) {
      return next(createError(400, 'Duplicate attachments are not allowed.'));
    }

    // 2. Store in DB
    const quoteData = {
      items: resolvedItems,
      attachments: resolvedAttachments,
      projectDescription: projectDescription || '',
      installationAddress: installationAddress || {},
      buildingType:  buildingType || 'residential',
      segment:       segment || null,
      enquiryQueue:  enquiryQueue || 'consumer',
      status:        'submitted',
    };

    if (isGuest) {
      quoteData.guestContact = {
        firstName: guestContact.firstName.trim(),
        lastName:  guestContact.lastName.trim(),
        email:     guestContact.email.toLowerCase().trim(),
        phone:     guestContact.phone || '',
        company:   guestContact.company || '',
      };
    } else {
      quoteData.user = req.user._id;
    }

    const quote = await Quote.create(quoteData);

    // Store the raw token before it's cleared, then clear it from the document
    const rawGuestToken = quote.guestToken || null;
    if (rawGuestToken) {
      quote.guestToken = null; // don't persist the raw token — only the hash stays
      await quote.save();
    }

    // 3. Enqueue emails (non-blocking)
    const contactEmail = isGuest
      ? quoteData.guestContact.email
      : req.user.email;
    const contactName = isGuest
      ? `${quoteData.guestContact.firstName} ${quoteData.guestContact.lastName}`
      : `${req.user.firstName} ${req.user.lastName}`;
    const frontendUrl = process.env.FRONTEND_URL || 'https://shadesology.com';

    // Build status URL — guests get a token link, users get their account page
    const statusUrl = isGuest && rawGuestToken
      ? `${frontendUrl}/quote/status/${quote.referenceNumber}?token=${rawGuestToken}`
      : `${frontendUrl}/account`;

    // Autoresponder to customer
    enqueueEmail({
      to:      contactEmail,
      subject: `Quote received — ${quote.referenceNumber}`,
      html: `
        <h2 style="color:#1B4332">Thank you, ${contactName.split(' ')[0]}!</h2>
        <p>We received your quote request (<strong>${quote.referenceNumber}</strong>) and our team will respond within 1 business day.</p>
        <p>You can track your quote status at:<br>
          <a href="${statusUrl}" style="color:#1B4332">View quote status</a>
        </p>
        <p>— The Shadesology Team</p>
      `,
      text: `Quote received — ${quote.referenceNumber}\n\nWe'll respond within 1 business day.\n\nTrack your quote: ${statusUrl}`,
    });

    // Staff notification
    let staffEmail = '';
    try {
      staffEmail = await resolveLeadRecipient({
        enquiryType: 'quote',
        productType: resolvedItems[0]?.productName || '',
        region: quoteData.installationAddress?.state || quoteData.installationAddress?.zip || '',
      });
    } catch (err) {
      console.error('[QuoteCtrl] Could not resolve quote routing; quote remains stored:', err.message);
    }
    if (staffEmail) {
      enqueueEmail({
        to:      staffEmail,
        subject: `New quote: ${quote.referenceNumber} (${enquiryQueue === 'commercial' ? 'COMMERCIAL' : 'consumer'})`,
        html: `
          <p><strong>Reference:</strong> ${quote.referenceNumber}</p>
          <p><strong>Contact:</strong> ${contactName} &lt;${contactEmail}&gt;</p>
          <p><strong>Items:</strong> ${resolvedItems.length}</p>
          <p><strong>Queue:</strong> ${enquiryQueue || 'consumer'}</p>
          <p><a href="${frontendUrl}/admin/quotes/${quote._id}">View in admin</a></p>
        `,
        text: `New quote ${quote.referenceNumber} from ${contactName} (${contactEmail}). Items: ${resolvedItems.length}.`,
      });
    }

    // 4. Enqueue CRM sync
    await hubspot.enqueueSync('quote', quote._id.toString());

    res.status(201).json({
      success: true,
      referenceNumber: quote.referenceNumber,
      quoteId: quote._id,
      // rawGuestToken returned ONCE in the response — after this it is gone.
      // The frontend must display the status link immediately so the user can bookmark it.
      ...(rawGuestToken ? { guestToken: rawGuestToken } : {}),
      message: 'Quote submitted. We\'ll be in touch within 1 business day.',
    });
  } catch (err) {
    next(err);
  }
};

// ─── Get customer's own quotes ─────────────────────────────────────────────────
const myQuotes = async (req, res, next) => {
  try {
    const quotes = await Quote.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .select('referenceNumber status items createdAt total expiresAt')
      .lean();

    res.json({ success: true, data: quotes });
  } catch (err) {
    next(err);
  }
};

// ─── Get single quote (customer's own) ────────────────────────────────────────
const getMyQuote = async (req, res, next) => {
  try {
    const quote = await Quote.findOne({
      _id:  req.params.id,
      user: req.user._id,
    })
      .populate('items.product', 'name slug images')
      .populate('items.variant', 'name sku')
      .select('-attachments')
      .lean();

    if (!quote) return next(createError(404, 'Quote not found.'));
    res.json({ success: true, data: quote });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: list all quotes ────────────────────────────────────────────────────
const adminListQuotes = async (req, res, next) => {
  try {
    const page   = Math.max(1, Number(req.query.page)  || 1);
    const limit  = Math.min(100, Number(req.query.limit) || 20);
    const status = req.query.status || null;
    const queue  = req.query.queue  || null;
    const assignedTo = req.query.assignedTo || null;

    const filter = {};
    if (status) filter.status = status;
    if (queue)  filter.enquiryQueue = queue;
    if (assignedTo) filter.assignedTo = assignedTo;

    const [quotes, total] = await Promise.all([
      Quote.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'firstName lastName email')
        .populate('assignedTo', 'firstName lastName')
        .lean(),
      Quote.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: quotes,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
};

const adminListStaff = async (req, res, next) => {
  try {
    const staff = await UserModel.find({ role: 'staff', isActive: true })
      .select('firstName lastName email staffRole')
      .sort({ firstName: 1, lastName: 1 })
      .lean();
    res.json({ success: true, data: staff });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: get single quote ──────────────────────────────────────────────────
const adminGetQuote = async (req, res, next) => {
  try {
    const quote = await Quote.findById(req.params.id)
      .populate('user', 'firstName lastName email phone role pricingGroup')
      .populate('items.product', 'name slug images productType')
      .populate('items.variant', 'name sku basePrice priceTiers')
      .populate('assignedTo', 'firstName lastName email')
      .lean();

    if (!quote) return next(createError(404, 'Quote not found.'));
    res.json({ success: true, data: quote });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: update quote status ───────────────────────────────────────────────
const adminUpdateQuote = async (req, res, next) => {
  try {
    const {
      status, assignedTo, note,
      subtotal, tax, total, items, priceLocked,
    } = req.body;

    const quote = await Quote.findById(req.params.id);
    if (!quote) return next(createError(404, 'Quote not found.'));

    const allowedStatuses = ['submitted', 'in_review', 'quoted', 'accepted', 'ordered', 'expired', 'declined'];
    if (status && !allowedStatuses.includes(status)) {
      return next(createError(400, `Invalid status: ${status}.`));
    }
    if (priceLocked !== undefined) {
      return next(createError(400, 'Price locking is managed by quote acceptance and cannot be set directly.'));
    }
    if (
      quote.priceLocked &&
      (subtotal !== undefined || tax !== undefined || total !== undefined || items !== undefined)
    ) {
      return next(createError(409, 'Pricing cannot be changed after the quote has been accepted.'));
    }
    for (const [label, amount] of Object.entries({ subtotal, tax, total })) {
      if (amount !== undefined && (!Number.isSafeInteger(amount) || amount < 0)) {
        return next(createError(400, `${label} must be a non-negative integer amount in cents.`));
      }
    }
    if (assignedTo) {
      if (!mongoose.Types.ObjectId.isValid(assignedTo)) {
        return next(createError(400, 'Assigned user ID is invalid.'));
      }
      const assignee = await UserModel.findOne({ _id: assignedTo, role: 'staff', isActive: true }).select('_id').lean();
      if (!assignee) return next(createError(400, 'Assigned user must be an active staff member.'));
    }
    if (items !== undefined && (!Array.isArray(items) || items.length !== quote.items.length)) {
      return next(createError(400, 'Item pricing must include every quote line in its original order.'));
    }
    if (items !== undefined) {
      for (const [index, item] of items.entries()) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return next(createError(400, 'Each item price entry must be an object.'));
        }
        if (
          item.unitPrice !== undefined &&
          (!Number.isSafeInteger(item.unitPrice) || item.unitPrice < 0)
        ) {
          return next(createError(400, 'Each unit price must be a non-negative integer amount in cents.'));
        }
        if (
          item.unitPrice !== undefined &&
          !Number.isSafeInteger(item.unitPrice * quote.items[index].quantity)
        ) {
          return next(createError(400, 'A quote line total exceeds the supported amount.'));
        }
      }
    }
    if (
      status === 'accepted' &&
      (quote.total === null || quote.total === undefined) &&
      total === undefined
    ) {
      return next(createError(400, 'Set a total price before accepting the quote.'));
    }
    if (
      status === 'accepted' &&
      !quote.items.every((item, index) => (
        (items?.[index]?.unitPrice ?? item.unitPrice) !== null &&
        (items?.[index]?.unitPrice ?? item.unitPrice) !== undefined
      ))
    ) {
      return next(createError(400, 'Set a unit price for every item before accepting the quote.'));
    }

    if (status && status !== quote.status) {
      quote.status = status;
      quote.statusHistory.push({
        status,
        changedBy: req.user._id,
        note:      note || '',
        at:        new Date(),
      });
      if (status === 'quoted') {
        const configuredDays = Number(process.env.QUOTE_EXPIRY_DAYS);
        const expiryDays = Number.isFinite(configuredDays) && configuredDays > 0 ? configuredDays : 30;
        quote.expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
        quote.followUpSentAt = null;
      }
      if (status === 'accepted') quote.priceLocked = true;
    }

    if (assignedTo !== undefined) quote.assignedTo = assignedTo || null;
    if (subtotal   !== undefined) quote.subtotal    = subtotal;
    if (tax        !== undefined) quote.tax         = tax;
    if (total      !== undefined) {
      quote.total      = total;
      quote.pricedAt   = new Date();
    }
    if (items !== undefined) {
      items.forEach((line, index) => {
        if (line.unitPrice === undefined) return;
        quote.items[index].unitPrice = line.unitPrice;
        quote.items[index].totalPrice = line.unitPrice * quote.items[index].quantity;
      });
      quote.pricedAt = new Date();
    }
    await quote.save();

    // Notify customer of status change
    if (status && ['quoted', 'accepted', 'declined'].includes(status)) {
      const contactEmail = quote.user
        ? (await require('../../models/User').findById(quote.user).select('email firstName').lean())
        : null;
      const email = quote.guestContact?.email || contactEmail?.email;
      const name  = quote.guestContact?.firstName || contactEmail?.firstName || 'Customer';

      if (email) {
        enqueueEmail({
          to:      email,
          subject: `Update on your quote ${quote.referenceNumber}`,
          html: `
            <h2 style="color:#1B4332">Quote update</h2>
            <p>Hi ${name},</p>
            <p>Your quote <strong>${quote.referenceNumber}</strong> status has been updated to: <strong>${status}</strong>.</p>
            ${note ? `<p>${note}</p>` : ''}
            <p><a href="${process.env.FRONTEND_URL || 'https://shadesology.com'}/account">View your quotes</a></p>
          `,
          text: `Your quote ${quote.referenceNumber} is now: ${status}.`,
        });
      }
    }

    res.json({ success: true, data: quote });
  } catch (err) {
    next(err);
  }
};

// ─── Guest: get quote status by referenceNumber + token ───────────────────────
const guestGetQuote = async (req, res, next) => {
  try {
    const { ref } = req.params;
    const { token } = req.query;

    if (!ref || !token) {
      return next(createError(400, 'Reference number and token are required.'));
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');

    const quote = await Quote.findOne({ referenceNumber: ref })
      .select('+guestTokenHash')
      .select('+guestTokenHashes')
      .populate('items.product', 'name slug images')
      .populate('items.variant', 'name sku')
      .lean();

    if (!quote) return next(createError(404, 'Quote not found.'));

    // Must be a guest quote (no user) with matching token
    if (quote.user) return next(createError(403, 'Please log in to view this quote.'));
    if (
      (!quote.guestTokenHash || quote.guestTokenHash !== tokenHash) &&
      !quote.guestTokenHashes?.includes(tokenHash)
    ) {
      return next(createError(403, 'Invalid or expired quote link.'));
    }

    // Strip the token hash from the response
    const safeQuote = { ...quote };
    delete safeQuote.guestTokenHash;
    delete safeQuote.guestTokenHashes;
    res.json({ success: true, data: safeQuote });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: convert accepted quote to order ────────────────────────────────────
const adminConvertQuoteToOrder = async (req, res, next) => {
  try {
    const quote = await Quote.findById(req.params.id)
      .populate('user', 'firstName lastName email phone')
      .populate('items.product', 'name slug')
      .populate('items.variant', 'name sku basePrice availability');

    if (!quote) return next(createError(404, 'Quote not found.'));

    if (quote.status !== 'accepted') {
      return next(createError(400, `Quote must be in "accepted" status to convert. Current: ${quote.status}.`));
    }

    if (quote.total === null || quote.total === undefined) {
      return next(createError(400, 'Quote must have a total price set before conversion.'));
    }
    if (quote.items.some((item) => item.unitPrice === null || item.unitPrice === undefined)) {
      return next(createError(400, 'Every quote item must have a unit price before conversion.'));
    }

    if (quote.orderId) {
      return next(createError(409, `Quote already converted to order ${quote.orderId}.`));
    }
    const existingOrder = await Order.findOne({ quoteId: quote._id, source: 'quote_conversion' })
      .select('_id orderNumber')
      .lean();
    if (existingOrder) {
      return next(createError(409, `Quote already converted to order ${existingOrder.orderNumber}.`));
    }

    // Lock pricing — snapshot the item prices as-is from the quote
    const orderItems = quote.items.map((item) => ({
      product:     item.product?._id || item.product,
      variant:     item.variant?._id || item.variant,
      productName: item.productName,
      variantName: item.variantName,
      sku:         item.sku,
      quantity:    item.quantity,
      availability: item.variant?.availability || 'made_to_order',
      selectedOptions: item.selectedOptions,
      // Use the quoted unit price — this is the locked price, NOT a fresh calculation
      unitPrice:   (item.unitPrice ?? 0) / 100,
      lineTotal:   (item.totalPrice ?? item.unitPrice * item.quantity) / 100,
      surcharges:  [],
      totalSurcharge: 0,
      priceType:   'quoted',
    }));

    const shippingAddress = req.body.shippingAddress || {
      firstName: quote.guestContact?.firstName || quote.user?.firstName || '',
      lastName:  quote.guestContact?.lastName  || quote.user?.lastName  || '',
      line1:     quote.installationAddress?.line1  || '',
      city:      quote.installationAddress?.city   || '',
      state:     quote.installationAddress?.state  || '',
      zip:       quote.installationAddress?.zip    || '',
      country:   quote.installationAddress?.country || 'US',
    };

    const order = await Order.create({
      user:      quote.user?._id || null,
      guestEmail: quote.guestContact?.email || null,
      guestName:  quote.guestContact
        ? `${quote.guestContact.firstName} ${quote.guestContact.lastName}`
        : null,
      isGuest:   !quote.user,
      items:     orderItems,
      shippingAddress,
      billingAddress: shippingAddress,
      subtotal:  (quote.subtotal ?? quote.total) / 100,
      tax:       (quote.tax ?? 0) / 100,
      total:     quote.total / 100,
      currency:  quote.currency || 'USD',
      source:    'quote_conversion',
      quoteId:   quote._id,
      status:    'confirmed',
      statusHistory: [{
        status:    'confirmed',
        note:      `Converted from quote ${quote.referenceNumber}`,
        changedBy: req.user._id,
        at:        new Date(),
      }],
      paymentStatus: 'pending',
    });

    // Mark quote as ordered with locked pricing
    quote.status       = 'ordered';
    quote.orderId      = order._id;
    quote.priceLocked  = true;
    quote.statusHistory.push({
      status:    'ordered',
      changedBy: req.user._id,
      note:      `Converted to order ${order.orderNumber}`,
      at:        new Date(),
    });
    await quote.save();

    await enqueueOrderEmail(order, 'confirmed', {
      note: `Your quote ${quote.referenceNumber} was converted to an order. Our team will contact you about payment and production.`,
    });

    // Enqueue CRM sync for the new order
    await hubspot.enqueueSync('order', order._id.toString());

    res.status(201).json({
      success: true,
      data: { order, quote },
    });
  } catch (err) {
    if (err.code === 11000 && err.keyPattern?.quoteId) {
      return next(createError(409, 'This quote has already been converted to an order.'));
    }
    next(err);
  }
};

// ─── Admin: request PDF generation ────────────────────────────────────────────
const adminGenerateQuotePdf = async (req, res, next) => {
  try {
    const quote = await Quote.findById(req.params.id).lean();
    if (!quote) return next(createError(404, 'Quote not found.'));

    // Enqueue PDF generation job (pdfWorker picks this up)
    try {
      await getQueue('pdf').add('generate-quote', {
        quoteId:    quote._id.toString(),
        requestedBy: req.user._id.toString(),
      }, { attempts: 3 });
    } catch (qErr) {
      console.error('[QuoteCtrl] PDF queue error:', qErr.message);
      return next(createError(503, 'PDF generation queue unavailable. Please try again.'));
    }

    res.json({ success: true, message: 'PDF generation queued. Refresh in a few seconds.' });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: get signed download URL for quote PDF ─────────────────────────────
const adminGetQuotePdfUrl = async (req, res, next) => {
  try {
    const quote = await Quote.findById(req.params.id).select('pdfS3Key status').lean();
    if (!quote) return next(createError(404, 'Quote not found.'));
    if (!quote.pdfS3Key) return next(createError(404, 'PDF not yet generated.'));

    const s3 = require('../../services/s3');
    const url = await s3.getSignedDownloadUrl(quote.pdfS3Key, 'private', 900);

    res.json({ success: true, url, expiresInSeconds: 900 });
  } catch (err) {
    next(err);
  }
};

const adminGetQuoteAttachmentUrl = async (req, res, next) => {
  try {
    const quote = await Quote.findById(req.params.id).select('attachments').lean();
    if (!quote) return next(createError(404, 'Quote not found.'));
    const attachment = quote.attachments.find(
      (file) => file._id.toString() === req.params.attachmentId
    );
    if (!attachment) return next(createError(404, 'Quote attachment not found.'));

    const url = await s3.getSignedDownloadUrl(attachment.s3Key, 'private', 900);
    res.json({ success: true, url, filename: attachment.filename, expiresInSeconds: 900 });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  submitQuote,
  myQuotes,
  getMyQuote,
  guestGetQuote,
  adminListQuotes,
  adminListStaff,
  adminGetQuote,
  adminUpdateQuote,
  adminConvertQuoteToOrder,
  adminGenerateQuotePdf,
  adminGetQuotePdfUrl,
  adminGetQuoteAttachmentUrl,
};
