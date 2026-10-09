'use strict';

const mongoose = require('mongoose');

const installerLeadSchema = new mongoose.Schema({
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  installer: { type: mongoose.Schema.Types.ObjectId, ref: 'Installer', required: true, index: true },
  status: {
    type: String,
    enum: ['offered', 'accepted', 'declined', 'contacted', 'scheduled', 'in_progress', 'completed', 'unable_to_complete'],
    default: 'offered',
    index: true,
  },
  offeredAt: { type: Date, default: Date.now },
  respondedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

installerLeadSchema.index({ lead: 1, installer: 1 }, { unique: true });
installerLeadSchema.index({ installer: 1, status: 1, offeredAt: -1 });

module.exports = mongoose.model('InstallerLead', installerLeadSchema);
