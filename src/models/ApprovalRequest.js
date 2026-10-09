const mongoose = require('mongoose');

/**
 * ApprovalRequest — generic approval workflow engine.
 *
 * Reused for:
 *   installer_application  — new installer sign-up
 *   dealer_application     — new dealer / reseller sign-up
 *   specifier_application  — architect / specifier sign-up
 *   trade_application      — generic trade / commercial account
 *   pricing_tier_change    — staff-only pricing group assignment
 *   role_upgrade           — customer requesting a role upgrade
 *
 * Flow: submitted → assigned (to a staff member) → approved | rejected
 * Notifications are sent at each status change (email adapter, Prompt 1.15).
 */
const approvalRequestSchema = new mongoose.Schema(
  {
    // ─── Type ────────────────────────────────────────────────────────────────
    type: {
      type: String,
      required: true,
      enum: [
        'installer_application',
        'dealer_application',
        'specifier_application',
        'trade_application',
        'pricing_tier_change',
        'role_upgrade',
      ],
    },

    // ─── Applicant ───────────────────────────────────────────────────────────
    applicant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      default: null,
    },

    // ─── Application data ─────────────────────────────────────────────────────
    // Flexible payload — stored as-is from the application form
    data: {
      type: Object,
      default: {},
      // Example fields by type:
      // installer: { licenseNumber, insuranceProvider, insuranceExpiry, experience, specialities, coverageAreas }
      // dealer:    { businessName, abn, yearsInBusiness, annualVolume, currentBrands }
      // specifier: { firmName, professionalBody, membershipNumber, projectTypes }
      // pricing:   { requestedTier, justification }
    },

    // Uploaded support documents (e.g. insurance cert, business registration)
    documents: [
      {
        label:   { type: String, default: '' },
        fileUrl: { type: String, required: true },
        contentType: { type: String, default: '' },
        sizeBytes: { type: Number, default: 0 },
        _id: false,
      },
    ],

    // ─── Workflow ─────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'in_review', 'approved', 'rejected', 'withdrawn'],
      default: 'pending',
    },

    // Staff member assigned to review this request
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    assignedAt: { type: Date, default: null },
    assignmentHistory: [{
      assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      assignedAt: { type: Date, default: Date.now },
      _id: false,
    }],

    // Resolution
    resolvedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt:  { type: Date, default: null },
    resolution:  { type: String, default: '' },   // internal note

    // What was granted on approval (e.g. role change, pricing tier)
    outcome: {
      roleGranted:        { type: String, default: '' },
      pricingGroupGranted:{ type: String, default: '' },
    },

    // ─── Notifications ────────────────────────────────────────────────────────
    // Track which notification emails have been sent
    notificationsSent: [
      {
        event:  { type: String },   // e.g. 'submitted', 'assigned', 'approved'
        sentAt: { type: Date },
        _id: false,
      },
    ],

    // Applicant-visible reference number e.g. "APP-20260001"
    referenceNumber: { type: String, unique: true, sparse: true },

    crmSyncStatus: {
      type: String,
      enum: ['pending', 'synced', 'failed', 'skipped'],
      default: 'pending',
    },
    hubspotContactId: { type: String, default: '' },
    hubspotCompanyId: { type: String, default: '' },
    crmLastSyncedAt: { type: Date, default: null },
    crmLastError: { type: String, default: '' },
  },
  { timestamps: true }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────
approvalRequestSchema.index({ applicant: 1 });
approvalRequestSchema.index({ status: 1 });
approvalRequestSchema.index({ type: 1, status: 1 });
approvalRequestSchema.index({ assignedTo: 1, status: 1 });
approvalRequestSchema.index({ referenceNumber: 1 });

// ─── Pre-save: generate reference number ─────────────────────────────────────
approvalRequestSchema.pre('save', async function () {
  if (this.referenceNumber) return;
  const year = new Date().getFullYear();
  const count = await this.constructor.countDocuments();
  this.referenceNumber = `APP-${year}${String(count + 1).padStart(4, '0')}`;
});

const ApprovalRequest = mongoose.model('ApprovalRequest', approvalRequestSchema);

module.exports = ApprovalRequest;
