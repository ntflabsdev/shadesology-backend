'use strict';

const Company = require('../models/Company');
const AuditLog = require('../models/AuditLog');

async function resolvePricingUser(user) {
  if (!user || user.role !== 'dealer') {return user || null;}
  if (!user.isEmailVerified) {
    return { ...user, role: 'customer', pricingGroup: '' };
  }
  const company = user.company
    ? await Company.findOne({
      _id: user.company,
      type: 'dealer',
      isActive: true,
      isApproved: true,
    }).select('pricingGroup').lean()
    : null;
  if (!company) {
    return { ...user, role: 'customer', pricingGroup: '' };
  }
  const pricingGroup = user.pricingGroup || company.pricingGroup || '';
  if (pricingGroup) {
    await AuditLog.record({
      event: 'pricing_viewed',
      actor: user._id,
      actorEmail: user.email,
      meta: { pricingGroup, companyId: String(company._id), audience: 'dealer' },
    });
  }
  return {
    ...user,
    pricingGroup,
  };
}

module.exports = { resolvePricingUser };
