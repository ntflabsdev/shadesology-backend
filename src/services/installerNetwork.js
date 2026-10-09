'use strict';

const Installer = require('../models/Installer');
const InstallerLead = require('../models/InstallerLead');
const Lead = require('../models/Lead');
const InstallerReferralConfig = require('../models/InstallerReferralConfig');
const { getQueue } = require('../queues');

function installerSlug(businessName, id) {
  const base = String(businessName || 'installer')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
  return `${base || 'installer'}-${String(id).slice(-6)}`;
}

function normalizePostcode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function escaped(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function distanceMiles(lat1, lng1, lat2, lng2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const deltaLat = radians(lat2 - lat1);
  const deltaLng = radians(lng2 - lng1);
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestCoverage(installer, location) {
  const points = [
    ...(installer.coverageAreas || []).filter((area) => Number.isFinite(area.lat) && Number.isFinite(area.lng)),
    ...(Number.isFinite(installer.lat) && Number.isFinite(installer.lng)
      ? [{ lat: installer.lat, lng: installer.lng, radiusMiles: 0 }]
      : []),
  ];
  if (!location || points.length === 0) {return { distance: null, covered: false };}
  const distances = points.map((point) => ({
    distance: distanceMiles(location.lat, location.lng, point.lat, point.lng),
    radius: Number(point.radiusMiles) || 0,
  }));
  distances.sort((a, b) => a.distance - b.distance);
  const nearest = distances[0];
  return { distance: Math.round(nearest.distance * 10) / 10, covered: nearest.distance <= nearest.radius };
}

async function searchInstallers({ query, lat, lng, sort = 'ranking', limit = 20 }) {
  const rawQuery = String(query || '').trim();
  if (!rawQuery) {return [];}
  const coordinates = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const normalized = normalizePostcode(rawQuery);
  const postcodePattern = normalized.split('').map(escaped).join('\\s*');
  const cityPattern = new RegExp(escaped(rawQuery), 'i');
  const filter = {
    isActive: true,
    status: 'approved',
    $or: [{ insuranceExpiry: null }, { insuranceExpiry: { $gt: new Date() } }],
  };
  if (!coordinates) {
    const partialPostcodePattern = normalized.length >= 3
      ? new RegExp(`^\\s*${postcodePattern}`, 'i')
      : null;
    filter.$and = [{
      $or: [
      { 'coverageAreas.postcode': new RegExp(`^\\s*${postcodePattern}\\s*$`, 'i') },
      ...(partialPostcodePattern ? [{ 'coverageAreas.postcode': partialPostcodePattern }] : []),
      { 'address.city': cityPattern },
      { 'address.state': cityPattern },
      { 'address.zip': cityPattern },
      ],
    }];
  }
  const installers = await Installer.find(filter)
    .limit(500)
    .select('businessName slug contactName email phone address coverageAreas lat lng specialities certifications isVerified rankingScore responseRatePercent avgResponseHours jobsCompleted description logo certifiedProductTypes')
    .lean();

  const results = installers.map((installer) => {
    const exactCoverage = (installer.coverageAreas || []).some(
      (area) => normalizePostcode(area.postcode) === normalized,
    );
    const partialPostcodeMatch = normalized.length >= 3 && (installer.coverageAreas || []).some(
      (area) => normalizePostcode(area.postcode).startsWith(normalized),
    );
    const locationMatch = [installer.address?.city, installer.address?.state, installer.address?.zip]
      .some((value) => value && cityPattern.test(value));
    const nearby = nearestCoverage(installer, coordinates);
    return { installer, exactCoverage, partialPostcodeMatch, locationMatch, nearby };
  }).filter(({ exactCoverage, partialPostcodeMatch, locationMatch, nearby }) =>
    exactCoverage || partialPostcodeMatch || locationMatch || (coordinates && nearby.covered));

  results.sort((a, b) => {
    if (sort === 'distance' && coordinates) {
      const aDistance = a.nearby.distance ?? Number.POSITIVE_INFINITY;
      const bDistance = b.nearby.distance ?? Number.POSITIVE_INFINITY;
      if (aDistance !== bDistance) {return aDistance - bDistance;}
    }
    return (Number(b.installer.rankingScore) || 0) - (Number(a.installer.rankingScore) || 0);
  });
  return results.slice(0, Math.max(1, Math.min(50, limit))).map(({ installer, nearby }) => ({
    ...installer,
    certifications: (installer.certifications || []).map(({ name, issuedAt, expiresAt }) => ({ name, issuedAt, expiresAt })),
    distance: nearby.distance,
  }));
}

async function offerNextInstaller(leadId, excludedInstallerIds = []) {
  const lead = await Lead.findById(leadId).lean();
  if (!lead || !lead.region) {return null;}
  if (['accepted', 'completed'].includes(lead.installerAssignment?.status)) {return null;}
  const existing = await InstallerLead.find({ lead: leadId }).select('installer').lean();
  const excluded = new Set([
    ...excludedInstallerIds.map(String),
    ...existing.map((entry) => String(entry.installer)),
  ]);
  const regionParts = String(lead.region).split(/[,\s]+/).map((part) => part.trim()).filter(Boolean);
  const postalCode = String(lead.region).match(/\b\d{5}(?:-\d{4})?\b/)?.[0];
  const searchTerms = [...new Set([postalCode, ...regionParts.slice(-1), regionParts[0], lead.region].filter(Boolean))];
  const candidates = [];
  const candidateIds = new Set();
  for (const query of searchTerms) {
    const matches = await searchInstallers({ query, sort: 'ranking', limit: 50 });
    for (const candidate of matches) {
      if (!candidateIds.has(String(candidate._id))) {
        candidateIds.add(String(candidate._id));
        candidates.push(candidate);
      }
    }
  }
  for (const candidate of candidates) {
    if (excluded.has(String(candidate._id))) {continue;}
    let assignment;
    try {
      assignment = await InstallerLead.create({ lead: leadId, installer: candidate._id });
    } catch (err) {
      if (err.code === 11000) {continue;}
      throw err;
    }
    const routed = await Lead.updateOne(
      { _id: leadId, 'installerAssignment.status': { $nin: ['accepted', 'completed'] } },
      { $set: { installerAssignment: { installer: candidate._id, status: 'offered', assignedAt: new Date() }, status: 'assigned' } },
    );
    if (routed.modifiedCount === 0) {
      await InstallerLead.deleteOne({ _id: assignment._id });
      return null;
    }
    try {
      await getQueue('email').add('send', {
        to: candidate.email,
        subject: 'A new installation lead is available',
        text: `A new ${lead.productType || 'installation'} lead is available in ${lead.region}. Sign in to your installer portal to accept or decline it.`,
      }, { jobId: `installer-offer-${assignment._id}` });
    } catch (err) {
      console.error('[Installer] Could not queue lead offer notification; assignment remains available:', err.message);
    }
    return assignment;
  }
  return null;
}

async function referralForRegion(region) {
  if (!region) {return null;}
  const config = await InstallerReferralConfig.findOne({
    region: String(region).trim().toUpperCase(),
    enabled: true,
  }).select('region partnerName partnerUrl').lean();
  return config || null;
}

function portalLeadFilter(installerId) {
  return { installer: installerId };
}

module.exports = {
  normalizePostcode,
  installerSlug,
  distanceMiles,
  nearestCoverage,
  searchInstallers,
  offerNextInstaller,
  referralForRegion,
  portalLeadFilter,
};
