'use strict';

const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');

/**
 * Installer — a certified shade installation professional.
 *
 * Coverage is stored as postcode/radius rules. A postcode search finds all
 * installers whose coverage overlaps the searched postcode.
 * Distance sorting requires lat/lng — geocoded at signup time.
 */

const coverageAreaSchema = new mongoose.Schema(
  {
    postcode: { type: String, required: true, trim: true },
    radiusMiles: { type: Number, min: 1, max: 500, default: 25 },
    lat: { type: Number, min: -90, max: 90 },
    lng: { type: Number, min: -180, max: 180 },
  },
  { _id: true }
);

const installerSchema = new mongoose.Schema(
  {
    // ─── Profile ──────────────────────────────────────────────────────────────
    businessName: { type: String, required: true, trim: true },
    slug: { type: String, unique: true, sparse: true },
    contactName:  { type: String, trim: true },
    email:        { type: String, lowercase: true, trim: true },
    phone:        String,
    website:      String,
    description:  translatableField(),
    logo:         String,
    profileImage: String,

    // ─── Address ──────────────────────────────────────────────────────────────
    address: {
      line1:   String,
      city:    { type: String, required: true },
      state:   { type: String, required: true },
      zip:     String,
      country: { type: String, default: 'US' },
    },
    lat: Number,
    lng: Number,

    // ─── Coverage ─────────────────────────────────────────────────────────────
    coverageAreas: [coverageAreaSchema],

    // ─── Specialities / certifications ────────────────────────────────────────
    specialities: [String], // e.g. ['Retractable Awnings', 'Pergolas']
    certifications: [
      {
        name:      String,
        issuedAt:  Date,
        expiresAt: Date,
        fileUrl:   String,
      },
    ],
    /** Product types this installer is certified to install */
    certifiedProductTypes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductType' }],

    // ─── Insurance / license ──────────────────────────────────────────────────
    licenseNumber:    String,
    licenseExpiry:    Date,
    insuranceProvider: String,
    insuranceExpiry:  Date,
    insuranceFileUrl: String,
    privateDocuments: [{
      label: String,
      key: { type: String, required: true },
      contentType: String,
      sizeBytes: Number,
      _id: false,
    }],
    yearsExperience:  Number,

    // ─── Status ───────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'approved', 'suspended', 'rejected'],
      default: 'pending',
      index: true,
    },
    isVerified: { type: Boolean, default: false },
    isActive:   { type: Boolean, default: false },

    // ─── Rankings ─────────────────────────────────────────────────────────────
    rankingScore: { type: Number, default: 0 },
    responseRatePercent: { type: Number, default: null },
    avgResponseHours:    { type: Number, default: null },
    jobsCompleted:       { type: Number, default: 0 },

    // ─── Linked user account ──────────────────────────────────────────────────
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // ─── Third-party referral ─────────────────────────────────────────────────
    /** When true, this installer is served via a third-party referral partner */
    isThirdPartyReferral: { type: Boolean, default: false },
    referralPartnerName:  String,
    referralPartnerUrl:   String,
    referralRegion:       String, // region toggle for the interim referral mode
  },
  {
    timestamps: true,
    collection: 'installers',
  }
);

installerSchema.index({ 'address.state': 1, isActive: 1 });
installerSchema.index({ 'coverageAreas.postcode': 1 });
installerSchema.index({ lat: 1, lng: 1 });
installerSchema.index({ rankingScore: -1, isActive: 1 });

module.exports = mongoose.model('Installer', installerSchema);
