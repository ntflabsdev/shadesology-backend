const NewsletterSubscriber = require('../../models/NewsletterSubscriber');
const { generateToken, hashToken } = require('../../utils/crypto');
const { createError } = require('../../middlewares/errorHandler');
const hubspot = require('../../services/hubspot');

// ─── Subscribe ────────────────────────────────────────────────────────────────
const subscribe = async (req, res, next) => {
  try {
    const { email, source = 'footer', interests = [], consentVersion = '' } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return next(createError(400, 'A valid email address is required.'));
    }

    const existing = await NewsletterSubscriber.findOne({ email: email.toLowerCase() });

    if (existing) {
      if (existing.status === 'confirmed') {
        // Already subscribed — silent success (don't reveal)
        return res.json({ success: true, message: 'Thank you for subscribing!' });
      }
      if (existing.status === 'unsubscribed') {
        // Re-subscribe flow — reset to pending
        existing.status = 'pending';
        existing.consentGiven   = true;
        existing.consentIp      = req.ip;
        existing.consentAt      = new Date();
        existing.consentVersion = consentVersion;
        existing.crmSyncStatus = 'pending';
        const rawToken = generateToken();
        existing.confirmToken   = hashToken(rawToken);
        existing.confirmExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await existing.save();
        await hubspot.enqueueSync('newsletter', existing._id.toString());
        // TODO Prompt 2.6: send confirmation email with rawToken
        return res.json({ success: true, message: 'Please check your email to confirm your subscription.' });
      }
      // Still pending — resend
      return res.json({ success: true, message: 'Please check your email to confirm your subscription.' });
    }

    const rawToken = generateToken();
    const subscriber = await NewsletterSubscriber.create({
      email,
      source,
      interests,
      status:         'pending',
      consentGiven:   true,
      consentIp:      req.ip,
      consentAt:      new Date(),
      consentVersion,
      confirmToken:   hashToken(rawToken),
      confirmExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    // TODO Prompt 2.6: send double opt-in confirmation email with rawToken
    // await emailAdapter.send({ to: email, template: 'newsletter-confirm', data: { token: rawToken } })

    await hubspot.enqueueSync('newsletter', subscriber._id.toString());
    res.status(201).json({
      success: true,
      message: 'Thank you! Please check your email to confirm your subscription.',
      // Dev only: expose token so it can be confirmed without email setup
      ...(process.env.NODE_ENV === 'development' && { _devConfirmToken: rawToken }),
    });
  } catch (err) {
    next(err);
  }
};

// ─── Confirm subscription ─────────────────────────────────────────────────────
const confirm = async (req, res, next) => {
  try {
    const { token } = req.params;
    const hashed = hashToken(token);

    const subscriber = await NewsletterSubscriber.findOne({
      confirmToken:   hashed,
      confirmExpires: { $gt: new Date() },
    }).select('+confirmToken +confirmExpires');

    if (!subscriber) {
      return next(createError(400, 'Confirmation link is invalid or has expired.'));
    }

    subscriber.status       = 'confirmed';
    subscriber.confirmedAt  = new Date();
    subscriber.confirmToken   = null;
    subscriber.confirmExpires = null;
    subscriber.crmSyncStatus = 'pending';
    await subscriber.save();
    await hubspot.enqueueSync('newsletter', subscriber._id.toString());

    res.json({ success: true, message: 'Subscription confirmed. Welcome aboard!' });
  } catch (err) {
    next(err);
  }
};

// ─── Unsubscribe ──────────────────────────────────────────────────────────────
const unsubscribe = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return next(createError(400, 'Email is required.'));

    const subscriber = await NewsletterSubscriber.findOneAndUpdate(
      { email: email.toLowerCase() },
      { $set: { status: 'unsubscribed', unsubscribedAt: new Date(), crmSyncStatus: 'pending' } },
      { new: true },
    );
    if (subscriber) {await hubspot.enqueueSync('newsletter', subscriber._id.toString());}

    // Always 200 — don't reveal if email was subscribed
    res.json({ success: true, message: 'You have been unsubscribed.' });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: list subscribers ──────────────────────────────────────────────────
const adminList = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 25 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, parseInt(limit, 10));

    const [docs, total] = await Promise.all([
      NewsletterSubscriber.find(filter)
        .sort('-createdAt')
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      NewsletterSubscriber.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: docs,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { subscribe, confirm, unsubscribe, adminList };
