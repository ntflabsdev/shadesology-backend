const mongoose = require('mongoose');

/**
 * NewsletterSubscriber — stores email signups from the footer and
 * mid-article newsletter capture forms.
 *
 * Only stores the email and consent details — the actual email platform
 * integration comes in Prompt 2.6 (email adapter).
 *
 * Double opt-in flow:
 *   1. User submits email → status: 'pending', confirmToken generated
 *   2. Confirmation email sent with token link (Prompt 2.6)
 *   3. User clicks link → status: 'confirmed'
 *   4. Unsubscribe link in every email → status: 'unsubscribed'
 */
const newsletterSubscriberSchema = new mongoose.Schema(
  {
    email: {
      type:     String,
      required: true,
      unique:   true,
      lowercase:true,
      trim:     true,
    },

    status: {
      type:    String,
      enum:    ['pending', 'confirmed', 'unsubscribed'],
      default: 'pending',
    },

    // Source of signup
    source: {
      type:    String,
      enum:    ['footer', 'article', 'checkout', 'popup', 'manual'],
      default: 'footer',
    },

    // Segment interests selected at signup
    interests: [{ type: String }],

    // Consent record (GDPR / CCPA)
    consentGiven:   { type: Boolean, default: false },
    consentIp:      { type: String, default: '' },
    consentAt:      { type: Date, default: null },
    consentVersion: { type: String, default: '' }, // privacy policy version

    // Double opt-in token (stored hashed)
    confirmToken:   { type: String, default: null, select: false },
    confirmExpires: { type: Date, default: null, select: false },
    confirmedAt:    { type: Date, default: null },

    unsubscribedAt: { type: Date, default: null },

    crmSyncStatus: {
      type: String,
      enum: ['pending', 'synced', 'failed', 'skipped'],
      default: 'pending',
    },
    hubspotContactId: { type: String, default: '' },
    crmLastSyncedAt: { type: Date, default: null },
    crmLastError: { type: String, default: '' },

    // Linked user account (if they later register)
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

newsletterSubscriberSchema.index({ email: 1 });
newsletterSubscriberSchema.index({ status: 1 });

const NewsletterSubscriber = mongoose.model('NewsletterSubscriber', newsletterSubscriberSchema);
module.exports = NewsletterSubscriber;
