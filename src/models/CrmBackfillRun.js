'use strict';

const mongoose = require('mongoose');

const crmBackfillRunSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  lastId: { type: mongoose.Schema.Types.ObjectId, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.models.CrmBackfillRun ||
  mongoose.model('CrmBackfillRun', crmBackfillRunSchema);
