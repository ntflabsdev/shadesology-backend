const mongoose = require('mongoose');

/**
 * AuditLog — immutable event log for security-sensitive actions.
 *
 * Captured events:
 *   pricing_viewed      — a price was served to a user (includes tier used)
 *   pricing_changed     — staff changed a price / tier
 *   document_accessed   — a gated document was downloaded
 *   role_changed        — user role was updated
 *   pricing_group_set   — pricing group assigned/changed by staff
 *   login               — successful login
 *   login_failed        — failed login attempt
 *   password_reset      — password was reset
 *   session_revoked     — all sessions revoked for a user
 *   approval_resolved   — approval request approved or rejected
 */
const auditLogSchema = new mongoose.Schema(
  {
    event: {
      type: String,
      required: true,
      enum: [
        'pricing_viewed',
        'pricing_changed',
        'document_accessed',
        'role_changed',
        'pricing_group_set',
        'login',
        'login_failed',
        'password_reset',
        'session_revoked',
        'approval_resolved',
        'approval_assigned',
        'company_member_invited',
        'company_member_joined',
        'company_updated',
        'dealer_claim_updated',
        'document_managed',
        'staff_status_changed',
        'privacy_request',
      ],
    },

    // Who performed the action (null for anonymous)
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    actorEmail: { type: String, default: '' }, // denormalized for log readability

    // Who was affected (may differ from actor e.g. staff changing another user)
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    subjectEmail: { type: String, default: '' },

    // Flexible payload — what changed / what was accessed
    meta: { type: Object, default: {} },
    // Examples:
    // pricing_viewed:   { productId, variantId, tierUsed, priceServed }
    // document_accessed:{ documentId, documentTitle, gating }
    // role_changed:     { fromRole, toRole }
    // pricing_group_set:{ fromGroup, toGroup }
    // approval_resolved:{ requestId, outcome }

    // Request context
    ip:        { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  {
    timestamps: true,
    // Audit logs are NEVER updated or deleted — no update hooks
  }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
auditLogSchema.index({ event: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ subject: 1, createdAt: -1 });

// ─── Prevent updates/deletes on audit logs ────────────────────────────────────
auditLogSchema.pre(['updateOne', 'findOneAndUpdate', 'findOneAndDelete', 'deleteOne', 'deleteMany'], function (next) {
  next(new Error('AuditLog records are immutable and cannot be modified or deleted.'));
});

/**
 * Static helper to record an event without throwing on failure.
 * Usage: await AuditLog.record({ event, actor, meta, ip })
 */
auditLogSchema.statics.record = async function (payload) {
  try {
    await this.create(payload);
  } catch (err) {
    // Never let audit logging failure break the main request
    console.error('AuditLog.record failed silently:', err.message);
  }
};

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;
