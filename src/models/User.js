const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * User — unified auth model for all portal types.
 *
 * Roles:
 *   customer   — retail buyer
 *   installer  — trade installer (approval required)
 *   specifier  — architect / designer (approval required)
 *   dealer     — reseller (approval required, pricing tier assigned by staff)
 *   staff      — internal (admin, sales, support, content)
 *
 * Pricing group is ONLY assigned by staff — never self-selected.
 * Session revocation: every token carries tokenVersion; bumping it invalidates all sessions.
 */
const userSchema = new mongoose.Schema(
  {
    // ─── Identity ────────────────────────────────────────────────────────────
    firstName: { type: String, required: true, trim: true },
    lastName:  { type: String, required: true, trim: true },
    email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone:     { type: String, trim: true, default: '' },

    // ─── Auth ────────────────────────────────────────────────────────────────
    passwordHash: { type: String, required: true, select: false },

    // ─── Role ────────────────────────────────────────────────────────────────
    role: {
      type: String,
      enum: ['customer', 'installer', 'specifier', 'dealer', 'staff'],
      default: 'customer',
    },

    // Staff sub-role (used for UI permissions within the admin panel)
    staffRole: {
      type: String,
      enum: ['admin', 'sales', 'support', 'content', ''],
      default: '',
    },

    // ─── Company ─────────────────────────────────────────────────────────────
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
    isCompanyAdmin: { type: Boolean, default: false },

    // ─── Pricing ─────────────────────────────────────────────────────────────
    // ONLY staff can set this — maps to priceTiers[].tierKey on Variant
    pricingGroup: { type: String, default: '' }, // '' = retail price

    // ─── Email verification ───────────────────────────────────────────────────
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationToken:   { type: String, default: null, select: false },
    emailVerificationExpires: { type: Date,   default: null, select: false },

    // ─── Password reset ───────────────────────────────────────────────────────
    passwordResetToken:   { type: String, default: null, select: false },
    passwordResetExpires: { type: Date,   default: null, select: false },

    // ─── Session revocation ───────────────────────────────────────────────────
    // Increment this to immediately invalidate ALL existing tokens for this user
    tokenVersion: { type: Number, default: 0 },

    // ─── Preferences ─────────────────────────────────────────────────────────
    locale:        { type: String, default: 'en' },
    units:         { type: String, enum: ['imperial', 'metric'], default: 'imperial' },
    currency:      { type: String, default: 'USD' },
    marketingConsent: { type: Boolean, default: false },

    // ─── Address book ────────────────────────────────────────────────────────
    addresses: [
      {
        label:      { type: String, default: 'Home' },
        line1:      { type: String, default: '' },
        line2:      { type: String, default: '' },
        city:       { type: String, default: '' },
        state:      { type: String, default: '' },
        zip:        { type: String, default: '' },
        country:    { type: String, default: 'US' },
        isDefault:  { type: Boolean, default: false },
        _id: false,
      },
    ],

    // ─── Status ──────────────────────────────────────────────────────────────
    isActive: { type: Boolean, default: true },
    suspendedAt:  { type: Date, default: null },
    suspendedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    suspendReason:{ type: String, default: '' },

    lastLoginAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) {
        // Never expose password-related or token fields in JSON output
        delete ret.passwordHash;
        delete ret.emailVerificationToken;
        delete ret.emailVerificationExpires;
        delete ret.passwordResetToken;
        delete ret.passwordResetExpires;
        delete ret.tokenVersion;
        return ret;
      },
    },
  }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
// NOTE: email already has unique:true in the field def — no need for a separate index
userSchema.index({ role: 1 });
userSchema.index({ company: 1 });
userSchema.index({ isActive: 1 });

// ─── Virtual: full name ───────────────────────────────────────────────────────
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// ─── Instance: compare password ───────────────────────────────────────────────
userSchema.methods.comparePassword = async function (plainText) {
  return bcrypt.compare(plainText, this.passwordHash);
};

// ─── Instance: revoke all sessions ───────────────────────────────────────────
userSchema.methods.revokeAllSessions = async function () {
  this.tokenVersion += 1;
  return this.save();
};

// ─── Pre-save: hash password if modified ─────────────────────────────────────
userSchema.pre('save', async function () {
  if (!this.isModified('passwordHash')) return;
  const salt = await bcrypt.genSalt(12);
  this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
});

const User = mongoose.model('User', userSchema);

module.exports = User;
