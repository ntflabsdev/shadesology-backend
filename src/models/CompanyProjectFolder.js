'use strict';

const mongoose = require('mongoose');

const companyProjectFolderSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  documents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Document' }],
}, { timestamps: true });

companyProjectFolderSchema.index({ company: 1, createdAt: -1 });

module.exports = mongoose.model('CompanyProjectFolder', companyProjectFolderSchema);
