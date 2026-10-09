const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');

/**
 * FooterConfig — CMS-editable footer content.
 *
 * One document (singleton). Staff edit link groups, social links,
 * contact info and legal text from /admin.
 */

const footerLinkSchema = new mongoose.Schema(
  {
    label:     translatableField({ required: true }),
    url:       { type: String, required: true },
    isExternal:{ type: Boolean, default: false },
    isActive:  { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const footerLinkGroupSchema = new mongoose.Schema(
  {
    heading:   translatableField({ required: true }),
    links:     [footerLinkSchema],
    isActive:  { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: true }
);

const footerConfigSchema = new mongoose.Schema(
  {
    // ─── Link groups (4–6 columns) ────────────────────────────────────────────
    linkGroups: [footerLinkGroupSchema],

    // ─── Contact info ─────────────────────────────────────────────────────────
    phone:   { type: String, default: '' },
    email:   { type: String, default: '' },
    address: translatableField(),

    // ─── Social links ─────────────────────────────────────────────────────────
    socialLinks: [
      {
        platform: {
          type: String,
          enum: ['facebook','instagram','pinterest','youtube','linkedin','twitter','tiktok','houzz'],
        },
        url: {
          type: String,
          required: true,
          validate: { validator: (value) => /^https:\/\//i.test(value), message: 'Social channel URLs must use HTTPS.' },
        },
        isActive:  { type: Boolean, default: true },
        sortOrder: { type: Number, default: 0 },
        _id: false,
      },
    ],

    instagramFeed: [
      {
        imageUrl: {
          type: String,
          required: true,
          maxlength: 2048,
          validate: { validator: (value) => /^https:\/\//i.test(value), message: 'Instagram feed images must use HTTPS.' },
        },
        imageAlt: { type: String, required: true, maxlength: 300 },
        permalink: {
          type: String,
          required: true,
          maxlength: 2048,
          validate: { validator: (value) => /^https:\/\/(www\.)?instagram\.com\//i.test(value), message: 'Instagram feed links must point to Instagram.' },
        },
        caption: { type: String, default: '', maxlength: 500 },
        isActive: { type: Boolean, default: true },
        sortOrder: { type: Number, default: 0 },
        _id: false,
      },
    ],

    // ─── Newsletter ───────────────────────────────────────────────────────────
    newsletterHeading:    translatableField(),
    newsletterSubheading: translatableField(),
    newsletterEnabled:    { type: Boolean, default: true },

    // ─── Bottom bar ───────────────────────────────────────────────────────────
    copyrightText:  translatableField(),
    legalLinks: [
      {
        label: translatableField(),
        url:   { type: String, required: true },
        _id:   false,
      },
    ],

    // ─── Locations (multi-location map embed) ─────────────────────────────────
    locations: [
      {
        name:     { type: String, default: '' },
        address:  translatableField(),
        phone:    { type: String, default: '' },
        email:    { type: String, default: '' },
        mapEmbedUrl: { type: String, default: '' },
        isActive: { type: Boolean, default: true },
        _id: false,
      },
    ],
  },
  { timestamps: true }
);

footerConfigSchema.pre('validate', function () {
  if (this.socialLinks.length > 10) {
    this.invalidate('socialLinks', 'A maximum of ten social channels may be configured.');
  }
  if (this.instagramFeed.length > 12) {
    this.invalidate('instagramFeed', 'A maximum of twelve Instagram feed items may be configured.');
  }
});

const FooterConfig = mongoose.model('FooterConfig', footerConfigSchema);
module.exports = FooterConfig;
