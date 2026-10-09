'use strict';

const mongoose = require('mongoose');

const installerReferralConfigSchema = new mongoose.Schema({
  region: { type: String, required: true, unique: true, trim: true, uppercase: true },
  enabled: { type: Boolean, default: false },
  partnerName: { type: String, trim: true, maxlength: 160, default: '' },
  partnerUrl: { type: String, trim: true, maxlength: 2048, default: '' },
  clicks: { type: Number, min: 0, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('InstallerReferralConfig', installerReferralConfigSchema);
