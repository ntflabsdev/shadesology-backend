const mongoose = require('mongoose');

/**
 * Company — a business account that can have multiple Users.
 * Used by dealers, installers, specifiers, and commercial customers.
 *
 * One user is designated companyAdmin and can:
 *   - Invite / remove users from the company
 *   - Update company profile details
 *
 * Pricing group is inherited by all users in the company
 * but can be overridden per-user by staff.
 */
const companySchema = new mongoose.Schema(
  {
    name:       { type: String, required: true, trim: true },
    tradingName:{ type: String, trim: true, default: '' },

    // Business details
    abn:         { type: String, trim: true, default: '' }, // or EIN / tax ID
    website:     { type: String, trim: true, default: '' },
    industry:    { type: String, trim: true, default: '' },

    // Primary contact
    phone:       { type: String, trim: true, default: '' },
    email:       { type: String, trim: true, lowercase: true, default: '' },

    // Address
    address: {
      line1:   { type: String, default: '' },
      line2:   { type: String, default: '' },
      city:    { type: String, default: '' },
      state:   { type: String, default: '' },
      zip:     { type: String, default: '' },
      country: { type: String, default: 'US' },
    },

    // ─── Users ───────────────────────────────────────────────────────────────
    // Admin user who manages this company account
    companyAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // ─── Pricing ─────────────────────────────────────────────────────────────
    // Company-level pricing group — inherited by all users unless overridden
    // ONLY set by staff via approval workflow
    pricingGroup: { type: String, default: '' },

    // Credit terms (for dealer/commercial accounts)
    creditLimit:  { type: Number, default: 0 },
    paymentTerms: { type: String, default: 'prepay' }, // e.g. 'net30', 'net60'
    pendingBalance: { type: Number, default: 0, min: 0 },

    // ─── Type ────────────────────────────────────────────────────────────────
    type: {
      type: String,
      enum: ['dealer', 'installer', 'specifier', 'commercial_customer', 'other'],
      default: 'other',
    },

    // ─── Status ──────────────────────────────────────────────────────────────
    hubspotCompanyId: { type: String, default: '' },
    isActive:   { type: Boolean, default: true },
    isApproved: { type: Boolean, default: false },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    notes: { type: String, default: '' }, // internal staff notes
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
companySchema.index({ name: 1 });
companySchema.index({ type: 1 });
companySchema.index({ isActive: 1, isApproved: 1 });

// ─── Virtual: members ────────────────────────────────────────────────────────
companySchema.virtual('members', {
  ref: 'User',
  localField: '_id',
  foreignField: 'company',
});

const Company = mongoose.model('Company', companySchema);

module.exports = Company;
