'use strict';

const Installer = require('../../models/Installer');
const InstallerLead = require('../../models/InstallerLead');
const InstallerReferralConfig = require('../../models/InstallerReferralConfig');
const Lead = require('../../models/Lead');
const ApprovalRequest = require('../../models/ApprovalRequest');
const ProductType = require('../../models/ProductType');
const { createError } = require('../../middlewares/errorHandler');
const { getQueue } = require('../../queues');
const s3 = require('../../services/s3');
const hubspot = require('../../services/hubspot');
const {
  normalizePostcode,
  installerSlug,
  searchInstallers: findInstallers,
  referralForRegion,
  portalLeadFilter,
  offerNextInstaller,
} = require('../../services/installerNetwork');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const APPLICATION_DOC_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

function validApplicationFile(contentType, sizeBytes) {
  const limit = contentType === 'application/pdf' ? s3.MAX_DOC_BYTES : s3.MAX_IMAGE_BYTES;
  return APPLICATION_DOC_TYPES.has(contentType) && Number.isSafeInteger(sizeBytes) && sizeBytes > 0 && sizeBytes <= limit;
}

function regionPreview(lead) {
  const explicit = [lead.applicationData?.city, lead.applicationData?.state].filter(Boolean);
  if (explicit.length) {
    return explicit.join(', ');
  }
  const parts = cleanText(lead.region, 100).split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    return parts.slice(-2).join(', ').replace(/\b\d{5}(?:-\d{4})?\b/g, '').trim();
  }
  return parts[0]?.replace(/\b\d{5}(?:-\d{4})?\b/g, '').trim() || '';
}

function cleanText(value, max = 500) {
  return typeof value === 'string' ? value.replace(/\p{Cc}/gu, ' ').trim().slice(0, max) : '';
}

function parseExpiryDate(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    parsed.setUTCHours(23, 59, 59, 999);
  }
  return parsed;
}

function parseCoordinates(query) {
  if (query.lat === undefined && query.lng === undefined) {return null;}
  const lat = Number(query.lat);
  const lng = Number(query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return false;
  }
  return { lat, lng };
}

async function getActiveInstaller(req) {
  const installer = await Installer.findOne({ user: req.user._id }).lean();
  if (!installer || installer.status !== 'approved' || !installer.isActive ||
    (installer.insuranceExpiry && new Date(installer.insuranceExpiry) <= new Date())) {
    throw createError(403, 'An approved installer profile is required.');
  }
  return installer;
}

async function sendEmail(to, subject, text, jobId) {
  if (!to) {return;}
  try {
    await getQueue('email').add('send', { to, subject, text }, { jobId });
  } catch (err) {
    console.error('[Installer] Email enqueue failed; application or job remains stored:', err.message);
  }
}

const searchInstallers = async (req, res, next) => {
  try {
    const query = cleanText(req.query.postcode || req.query.q, 120);
    if (!query) {return next(createError(400, 'postcode or q query parameter is required.'));}
    const coordinates = parseCoordinates(req.query);
    if (coordinates === false) {return next(createError(400, 'lat and lng must be valid coordinates.'));}
    const sort = req.query.sort === 'distance' ? 'distance' : 'ranking';
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {return next(createError(400, 'limit must be between 1 and 50.'));}
    const installers = await findInstallers({
      query,
      lat: coordinates?.lat,
      lng: coordinates?.lng,
      sort,
      limit,
    });
    const region = /^[A-Za-z]{2}$/.test(query) ? query.toUpperCase() : '';
    const referral = await referralForRegion(region);
    res.json({
      success: true,
      data: installers,
      coverageGap: installers.length === 0,
      query,
      count: installers.length,
      referral,
    });
  } catch (err) {
    next(err);
  }
};

const getInstallerProfile = async (req, res, next) => {
  try {
    const installer = await Installer.findOne({
      slug: req.params.slug,
      isActive: true,
      status: 'approved',
    })
      .populate('certifiedProductTypes', 'name slug code')
      .select('-user -insuranceFileUrl -licenseNumber -licenseExpiry -insuranceExpiry -insuranceProvider -privateDocuments')
      .lean();
    if (!installer) {return next(createError(404, 'Installer not found.'));}
    installer.certifications = (installer.certifications || []).map(({ name, issuedAt, expiresAt }) => ({ name, issuedAt, expiresAt }));
    res.json({ success: true, data: installer });
  } catch (err) {
    next(err);
  }
};

const getApplicationUploadUrl = async (req, res, next) => {
  try {
    const { filename, contentType, sizeBytes } = req.body || {};
    if (!validApplicationFile(contentType, sizeBytes)) {
      return next(createError(400, 'Application documents must be PDF, JPEG, PNG or WebP and within the file-size limit.'));
    }
    const maxBytes = contentType === 'application/pdf' ? s3.MAX_DOC_BYTES : s3.MAX_IMAGE_BYTES;
    const upload = await s3.getSignedUploadUrl(
      'private',
      'installer-applications',
      String(req.user._id),
      filename,
      contentType,
      maxBytes
    );
    res.json({ success: true, data: upload });
  } catch (err) {
    next(err);
  }
};

const submitInstallerApplication = async (req, res, next) => {
  try {
    const data = req.body || {};
    if (cleanText(data.faxNumber, 300)) {
      return res.status(202).json({ success: true, message: 'Application submitted for review.' });
    }
    const businessName = cleanText(data.businessName, 200);
    const contactName = cleanText(data.contactName, 200) || `${req.user.firstName} ${req.user.lastName}`.trim();
    const city = cleanText(data.city, 120);
    const state = cleanText(data.state, 80).toUpperCase();
    const phone = cleanText(data.phone || req.user.phone, 40);
    const email = cleanText(req.user.email, 254).toLowerCase();
    const licenseNumber = cleanText(data.licenseNumber, 120);
    const insuranceProvider = cleanText(data.insuranceProvider, 160);
    const experience = Number(data.yearsExperience);
    const insuranceExpiry = parseExpiryDate(data.insuranceExpiry);
    const licenseExpiry = parseExpiryDate(data.licenseExpiry);
    const rawCoverage = Array.isArray(data.coverageAreas)
      ? data.coverageAreas
      : String(data.coverageZips || '').split(',');
    const coverageAreas = rawCoverage.map((entry) => {
      const postcode = normalizePostcode(typeof entry === 'string' ? entry : entry?.postcode);
      const radiusMiles = typeof entry === 'string' || entry?.radiusMiles === undefined ? 25 : Number(entry.radiusMiles);
      const lat = typeof entry === 'string' || entry?.lat === undefined || entry?.lat === null ? undefined : Number(entry.lat);
      const lng = typeof entry === 'string' || entry?.lng === undefined || entry?.lng === null ? undefined : Number(entry.lng);
      return { postcode, radiusMiles, ...(lat !== undefined ? { lat } : {}), ...(lng !== undefined ? { lng } : {}) };
    }).filter((entry) => entry.postcode);

    if (businessName.length < 2 || contactName.length < 2 || !EMAIL_RE.test(email) ||
      phone.length < 7 || !city || !state || !licenseNumber || !insuranceProvider ||
      !Number.isFinite(experience) || experience < 0 || experience > 100 ||
      !insuranceExpiry || Number.isNaN(insuranceExpiry.getTime()) || insuranceExpiry <= new Date() ||
      (data.licenseExpiry && (!licenseExpiry || Number.isNaN(licenseExpiry.getTime()))) ||
      coverageAreas.length === 0 ||             coverageAreas.some((area) => !Number.isFinite(area.radiusMiles) || area.radiusMiles < 1 || area.radiusMiles > 500 ||
        (area.lat !== undefined && (!Number.isFinite(area.lat) || area.lat < -90 || area.lat > 90)) ||
        (area.lng !== undefined && (!Number.isFinite(area.lng) || area.lng < -180 || area.lng > 180)) ||
        ((area.lat === undefined) !== (area.lng === undefined)))) {
      return next(createError(400, 'Complete all required business, license, insurance, experience and coverage fields.'));
    }
    if (new Set(coverageAreas.map((area) => area.postcode)).size !== coverageAreas.length) {
      return next(createError(400, 'Coverage postcodes must be unique.'));
    }
    const duplicate = await ApprovalRequest.findOne({
      applicant: req.user._id,
      type: 'installer_application',
      status: { $in: ['pending', 'in_review'] },
    }).lean();
    if (duplicate) {return next(createError(409, `You already have a pending application (ref: ${duplicate.referenceNumber}).`));}
    const activeProfile = await Installer.findOne({ user: req.user._id, status: 'approved', isActive: true }).select('_id').lean();
    if (activeProfile) {return next(createError(409, 'Your installer account is already approved.'));}

    const documents = Array.isArray(data.documents) ? data.documents : [];
    if (documents.length > 5) {return next(createError(400, 'A maximum of five application documents may be uploaded.'));}
    const privateDocuments = await Promise.all(documents.map(async (document) => {
      const key = typeof document?.key === 'string' ? document.key : '';
      const prefix = `${process.env.NODE_ENV || 'development'}/installer-applications/${req.user._id}/`;
      if (!key.startsWith(prefix)) {throw createError(400, 'One or more application documents are invalid.');}
      const file = await s3.headFile(key, 'private');
      if (!file.exists || !validApplicationFile(file.contentType, file.contentLength)) {
        throw createError(400, 'An application document has an unsupported type or size.');
      }
      return {
        label: cleanText(document.label, 100) || 'Supporting document',
        fileUrl: key,
        contentType: file.contentType,
        sizeBytes: file.contentLength,
      };
    }));
    if (new Set(privateDocuments.map((document) => document.fileUrl)).size !== privateDocuments.length) {
      return next(createError(400, 'Duplicate application documents are not allowed.'));
    }

    const applicationData = {
      businessName,
      contactName,
      phone,
      city,
      state,
      coverageAreas,
      licenseNumber,
      licenseExpiry,
      insuranceProvider,
      insuranceExpiry,
      yearsExperience: experience,
      specialities: Array.isArray(data.specialities) ? data.specialities.map((value) => cleanText(value, 100)).filter(Boolean).slice(0, 20) : [],
      description: cleanText(data.description, 3000),
    };
    const installer = await Installer.findOneAndUpdate(
      { user: req.user._id },
      {
        $set: {
          businessName,
          slug: installerSlug(businessName, req.user._id),
          contactName,
          email,
          phone,
          address: { city, state, country: 'US' },
          coverageAreas,
          licenseNumber,
          licenseExpiry,
          insuranceProvider,
          insuranceExpiry,
          yearsExperience: experience,
          specialities: applicationData.specialities,
          description: applicationData.description,
          privateDocuments: privateDocuments.map((document) => ({
            label: document.label,
            key: document.fileUrl,
            contentType: document.contentType,
            sizeBytes: document.sizeBytes,
          })),
          status: 'pending',
          isActive: false,
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    let request;
    try {
      request = await ApprovalRequest.create({
        type: 'installer_application',
        applicant: req.user._id,
        company: req.user.company || null,
        data: applicationData,
        documents: privateDocuments,
      });
    } catch (err) {
      await Installer.deleteOne({ _id: installer._id, status: 'pending' });
      throw err;
    }
    await hubspot.enqueueSync('application', request._id.toString());
    await sendEmail(
      req.user.email,
      'We received your installer application',
      `Your installer application is awaiting review.\nReference: ${request.referenceNumber}`,
      `installer-application-received-${request._id}`,
    );
    try {
      const { resolveLeadRecipient } = require('../../services/leadRouting');
      const notificationEmail = await resolveLeadRecipient({
        enquiryType: 'installer',
        productType: applicationData.specialities.join(','),
        region: state,
      });
      await sendEmail(
        notificationEmail,
        `Installer application received (${request.referenceNumber})`,
        `${businessName} applied to join the installer network.\nApplicant: ${contactName} (${email})\nRegion: ${city}, ${state}\nReference: ${request.referenceNumber}`,
        `installer-application-staff-${request._id}`,
      );
      if (!notificationEmail) {
        console.error('[Installer] No staff notification recipient configured; application remains stored:', String(request._id));
      }
    } catch (err) {
      console.error('[Installer] Could not route application notification; application remains stored:', err.message);
    }
    res.status(201).json({
      success: true,
      message: 'Application submitted for review.',
      referenceNumber: request.referenceNumber,
      data: { id: request._id, referenceNumber: request.referenceNumber, status: request.status },
    });
  } catch (err) {
    next(err);
  }
};

const myInstallerApplication = async (req, res, next) => {
  try {
    const application = await ApprovalRequest.findOne({
      applicant: req.user._id,
      type: 'installer_application',
    }).sort({ createdAt: -1 }).select('-documents.fileUrl -documents.contentType -documents.sizeBytes -data -resolution').lean();
    const installer = await Installer.findOne({ user: req.user._id }).select('status isActive slug').lean();
    res.json({ success: true, data: { application, installer } });
  } catch (err) {
    next(err);
  }
};

const portalLeads = async (req, res, next) => {
  try {
    const installer = await getActiveInstaller(req);
    const assignments = await InstallerLead.find(portalLeadFilter(installer._id))
      .sort({ offeredAt: -1 })
      .limit(100)
      .populate('lead', 'name email phone enquiryType subject issueType message productType region orderNumber installDate createdAt applicationData')
      .lean();
    const data = assignments.map((assignment) => {
      let lead = assignment.lead;
      if (lead && assignment.status === 'offered') {
        lead = { ...lead };
        delete lead.name;
        delete lead.email;
        delete lead.phone;
        delete lead.orderNumber;
        lead.region = regionPreview(lead);
        delete lead.applicationData;
        lead.subject = cleanText(lead.subject, 200).replace(CONTACT_EMAIL_RE, '[email]');
        lead.issueType = cleanText(lead.issueType, 100).replace(CONTACT_EMAIL_RE, '[email]');
        lead.message = 'Accept this lead to view project details and customer contact information.';
      }
      return { ...assignment, lead };
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const portalProfile = async (req, res, next) => {
  try {
    const installer = await getActiveInstaller(req);
    const profile = await Installer.findById(installer._id)
      .populate('certifiedProductTypes', 'name slug')
      .select('businessName coverageAreas specialities certifiedProductTypes responseRatePercent avgResponseHours jobsCompleted')
      .lean();
    res.json({ success: true, data: profile });
  } catch (err) {
    next(err);
  }
};

const respondToLead = async (req, res, next) => {
  try {
    const installer = await getActiveInstaller(req);
    if (!['accept', 'decline'].includes(req.params.action)) {return next(createError(400, 'Invalid lead action.'));}
    const status = req.params.action === 'accept' ? 'accepted' : 'declined';
    const assignment = await InstallerLead.findOneAndUpdate(
      { _id: req.params.id, ...portalLeadFilter(installer._id), status: 'offered' },
      { $set: { status, respondedAt: new Date() } },
      { new: true },
    ).populate('lead');
    if (!assignment) {return next(createError(404, 'Available installer lead not found.'));}

    if (status === 'accepted') {
      const lead = await Lead.findOneAndUpdate(
        { _id: assignment.lead._id, 'installerAssignment.installer': installer._id, 'installerAssignment.status': 'offered' },
        { $set: { 'installerAssignment.status': 'accepted', 'installerAssignment.acceptedAt': new Date() } },
        { new: true },
      );
      if (!lead) {
        await InstallerLead.updateOne({ _id: assignment._id, status: 'accepted' }, { $set: { status: 'offered', respondedAt: null } });
        return next(createError(409, 'This lead is no longer available.'));
      }
      await sendEmail(lead.email, 'An installer has accepted your request', 'An installer has accepted your request and will contact you shortly.', `installer-accepted-${lead._id}`);
    } else {
      await Lead.updateOne(
        { _id: assignment.lead._id, 'installerAssignment.installer': installer._id, 'installerAssignment.status': 'offered' },
        { $set: { 'installerAssignment.status': 'declined' } },
      );
      await offerNextInstaller(assignment.lead._id, [installer._id]);
    }
    const offerStats = await InstallerLead.aggregate([
      { $match: { installer: installer._id } },
      { $group: { _id: null, total: { $sum: 1 }, responded: { $sum: { $cond: [{ $ne: ['$status', 'offered'] }, 1, 0] } }, responseMs: { $avg: { $cond: [{ $ne: ['$respondedAt', null] }, { $subtract: ['$respondedAt', '$offeredAt'] }, null] } } } },
    ]);
    const stats = offerStats[0];
    if (stats?.total) {
      await Installer.updateOne({ _id: installer._id }, {
        $set: {
          responseRatePercent: Math.round(stats.responded * 10000 / stats.total) / 100,
          avgResponseHours: Number.isFinite(stats.responseMs) ? Math.round(stats.responseMs / 360000) / 10 : null,
        },
      });
    }
    const responseLead = status === 'accepted'
      ? {
          id: assignment.lead._id,
          name: assignment.lead.name,
          email: assignment.lead.email,
          phone: assignment.lead.phone,
          message: assignment.lead.message,
          region: assignment.lead.region,
          productType: assignment.lead.productType,
        }
      : undefined;
    res.json({
      success: true,
      data: {
        assignment: {
          id: assignment._id,
          status: assignment.status,
          offeredAt: assignment.offeredAt,
          respondedAt: assignment.respondedAt,
        },
        lead: responseLead,
      },
    });
  } catch (err) {
    next(err);
  }
};

const updateJobStatus = async (req, res, next) => {
  try {
    const installer = await getActiveInstaller(req);
    const allowed = ['contacted', 'scheduled', 'in_progress', 'completed', 'unable_to_complete'];
    if (!allowed.includes(req.body.status)) {return next(createError(400, 'Invalid job status.'));}
    const assignment = await InstallerLead.findOne({
      _id: req.params.id,
      ...portalLeadFilter(installer._id),
      status: { $in: ['accepted', 'contacted', 'scheduled', 'in_progress'] },
    }).populate('lead');
    if (!assignment) {return next(createError(404, 'Accepted installer job not found.'));}
    assignment.status = req.body.status;
    if (req.body.status === 'completed') {assignment.completedAt = new Date();}
    await assignment.save();
    await sendEmail(
      assignment.lead.email,
      'Your installation request status changed',
      `Your installation request is now marked "${req.body.status.replaceAll('_', ' ')}".`,
      `installer-status-${assignment._id}-${req.body.status}`,
    );
    if (req.body.status === 'completed') {
      await Lead.updateOne({ _id: assignment.lead._id }, { $set: { 'installerAssignment.status': 'completed', status: 'closed' } });
      await Installer.updateOne({ _id: installer._id }, { $inc: { jobsCompleted: 1 } });
    }
    res.json({
      success: true,
      data: {
        id: assignment._id,
        status: assignment.status,
        lead: {
          name: assignment.lead.name,
          email: assignment.lead.email,
          phone: assignment.lead.phone,
          region: assignment.lead.region,
          productType: assignment.lead.productType,
          subject: assignment.lead.subject,
          message: assignment.lead.message,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

const updateCoverage = async (req, res, next) => {
  try {
    const installer = await getActiveInstaller(req);
    if (!Array.isArray(req.body.coverageAreas) || req.body.coverageAreas.length > 30) {
      return next(createError(400, 'coverageAreas must contain no more than 30 postcode rules.'));
    }
    const coverageAreas = req.body.coverageAreas.map((area) => ({
      postcode: normalizePostcode(area?.postcode),
      radiusMiles: Number(area?.radiusMiles),
      ...(area?.lat !== undefined && area?.lat !== null ? { lat: Number(area.lat) } : {}),
      ...(area?.lng !== undefined && area?.lng !== null ? { lng: Number(area.lng) } : {}),
    }));
    if (coverageAreas.some((area) => !area.postcode || !Number.isFinite(area.radiusMiles) || area.radiusMiles < 1 || area.radiusMiles > 500 ||
      (area.lat !== undefined && (!Number.isFinite(area.lat) || area.lat < -90 || area.lat > 90)) ||
      (area.lng !== undefined && (!Number.isFinite(area.lng) || area.lng < -180 || area.lng > 180)) ||
      ((area.lat === undefined) !== (area.lng === undefined)))) {
      return next(createError(400, 'Each coverage rule needs a postcode and radius between 1 and 500 miles.'));
    }
    if (new Set(coverageAreas.map((area) => area.postcode)).size !== coverageAreas.length) {
      return next(createError(400, 'Coverage postcodes must be unique.'));
    }
    const updated = await Installer.findByIdAndUpdate(installer._id, { $set: { coverageAreas } }, { new: true })
      .select('coverageAreas');
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

const certifiedDocuments = async (req, res, next) => {
  try {
    const installer = await getActiveInstaller(req);
    if (!req.query.productType || !installer.certifiedProductTypes.some((id) => String(id) === String(req.query.productType))) {
      return next(createError(403, 'Technical documents are available only for products you are certified to install.'));
    }
    const Document = require('../../models/Document');
    const docs = await Document.find({
      isActive: true,
      productTypes: req.query.productType,
      $or: [{ audienceTags: 'installer' }, { requiredRole: 'installer' }],
      $and: [
        { $or: [{ effectiveDate: null }, { effectiveDate: { $lte: new Date() } }] },
        { $or: [{ expiryDate: null }, { expiryDate: { $gt: new Date() } }] },
      ],
    }).select('title description fileUrl currentVersion fileSizeBytes mimeType productTypes').lean();
    const data = await Promise.all(docs.map(async (doc) => ({
      id: doc._id,
      title: doc.title,
      description: doc.description,
      version: doc.currentVersion,
      mimeType: doc.mimeType,
      fileSizeBytes: doc.fileSizeBytes,
      downloadUrl: doc.fileUrl && !doc.fileUrl.startsWith('http')
        ? await s3.getSignedDownloadUrl(doc.fileUrl, 'private', 300)
        : doc.fileUrl,
      expiresIn: doc.fileUrl && !doc.fileUrl.startsWith('http') ? 300 : null,
    })));
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

const trackReferralClick = async (req, res, next) => {
  try {
    const config = await InstallerReferralConfig.findOneAndUpdate(
      { region: cleanText(req.params.region, 20).toUpperCase(), enabled: true },
      { $inc: { clicks: 1 } },
      { new: true },
    ).select('partnerUrl').lean();
    if (!config) {return next(createError(404, 'No active referral is configured for this region.'));}
    res.json({ success: true, data: { partnerUrl: config.partnerUrl } });
  } catch (err) {
    next(err);
  }
};

const adminListInstallers = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Number(req.query.limit) || 25);
    const filter = {};
    if (req.query.status) {filter.status = req.query.status;}
    const [installers, total] = await Promise.all([
      Installer.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('-privateDocuments.key -insuranceFileUrl').lean(),
      Installer.countDocuments(filter),
    ]);
    res.json({ success: true, data: installers, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
};

const adminUpdateInstaller = async (req, res, next) => {
  try {
    const { status, isActive, isVerified, rankingScore, certifiedProductTypes, specialities } = req.body;
    if (status === 'approved') {
      const existing = await Installer.findById(req.params.id).select('user').lean();
      const approvedApplication = existing?.user && await ApprovalRequest.exists({
        applicant: existing.user,
        type: 'installer_application',
        status: 'approved',
      });
      if (!approvedApplication) {
        return next(createError(400, 'Approve installer applications through the shared approval workflow.'));
      }
    }
    const updates = {};
    if (status !== undefined) {updates.status = status;}
    if (status === 'approved') {updates.isActive = true;}
    if (isActive !== undefined) {updates.isActive = isActive;}
    if (isVerified !== undefined) {updates.isVerified = isVerified;}
    if (rankingScore !== undefined) {
      const score = Number(rankingScore);
      if (!Number.isFinite(score) || score < 0 || score > 1000) {return next(createError(400, 'rankingScore must be between 0 and 1000.'));}
      updates.rankingScore = score;
    }
    if (certifiedProductTypes !== undefined) {
      if (!Array.isArray(certifiedProductTypes) || certifiedProductTypes.length > 50 ||
        certifiedProductTypes.some((id) => typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id))) {
        return next(createError(400, 'certifiedProductTypes must be an array of product type IDs.'));
      }
      const matchingTypes = await ProductType.countDocuments({ _id: { $in: certifiedProductTypes }, isActive: true });
      if (matchingTypes !== certifiedProductTypes.length) {
        return next(createError(400, 'Each certification must reference an active product type.'));
      }
      updates.certifiedProductTypes = certifiedProductTypes;
    }
    if (specialities !== undefined) {
      if (!Array.isArray(specialities) || specialities.length > 30 ||
        specialities.some((value) => typeof value !== 'string' || !value.trim() || value.length > 100)) {
        return next(createError(400, 'specialities must be an array of up to 30 labels.'));
      }
      updates.specialities = specialities.map((value) => cleanText(value, 100));
    }
    const installer = await Installer.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true })
      .select('-privateDocuments.key -insuranceFileUrl');
    if (!installer) {return next(createError(404, 'Installer not found.'));}
    res.json({ success: true, data: installer });
  } catch (err) {
    next(err);
  }
};

const adminLeadFlowStats = async (req, res, next) => {
  try {
    const stats = await InstallerLead.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const counts = Object.fromEntries(stats.map((entry) => [entry._id, entry.count]));
    const offered = (counts.offered || 0) + (counts.accepted || 0) + (counts.declined || 0) +
      (counts.contacted || 0) + (counts.scheduled || 0) + (counts.in_progress || 0) +
      (counts.completed || 0) + (counts.unable_to_complete || 0);
    const responded = offered - (counts.offered || 0);
    res.json({ success: true, data: { counts, offers: offered, responseRatePercent: offered ? Math.round(responded * 10000 / offered) / 100 : 0 } });
  } catch (err) {
    next(err);
  }
};

const adminReferralConfigs = async (req, res, next) => {
  try {
    if (req.method === 'GET') {
      const data = await InstallerReferralConfig.find().sort({ region: 1 }).lean();
      return res.json({ success: true, data });
    }
    const region = cleanText(req.body.region, 20).toUpperCase();
    const enabled = req.body.enabled;
    const partnerName = cleanText(req.body.partnerName, 160);
    const partnerUrl = cleanText(req.body.partnerUrl, 2048);
    if (!/^[A-Z0-9-]{2,20}$/.test(region) || typeof enabled !== 'boolean') {
      return next(createError(400, 'A valid region and boolean enabled value are required.'));
    }
    if (partnerUrl) {
      try {
        const url = new URL(partnerUrl);
        if (url.protocol !== 'https:') {throw new Error('HTTPS required');}
      } catch {
        return next(createError(400, 'partnerUrl must be a valid HTTPS URL.'));
      }
    }
    if (enabled && (!partnerName || !partnerUrl)) {
      return next(createError(400, 'Enabled referral regions require a partner name and HTTPS URL.'));
    }
    const config = await InstallerReferralConfig.findOneAndUpdate(
      { region },
      { $set: { enabled, partnerName, partnerUrl } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    res.json({ success: true, data: config });
  } catch (err) {
    next(err);
  }
};

const adminApplicationDocument = async (req, res, next) => {
  try {
    const request = await ApprovalRequest.findOne({ _id: req.params.id, type: 'installer_application' }).lean();
    const index = Number(req.params.index);
    const document = Number.isInteger(index) && index >= 0 ? request?.documents?.[index] : null;
    if (!document?.fileUrl) {return next(createError(404, 'Application document not found.'));}
    const prefix = `${process.env.NODE_ENV || 'development'}/installer-applications/${request.applicant}/`;
    if (!document.fileUrl.startsWith(prefix)) {return next(createError(403, 'Invalid application document reference.'));}
    res.redirect(302, await s3.getSignedDownloadUrl(document.fileUrl, 'private', 300));
  } catch (err) {
    next(err);
  }
};

const adminAssignLead = async (req, res, next) => {
  try {
    const installer = await Installer.findOne({ _id: req.body.installerId, isActive: true, status: 'approved' });
    if (!installer) {return next(createError(404, 'Active approved installer not found.'));}
    const lead = await Lead.findOne({
      _id: req.params.leadId,
      'installerAssignment.status': { $nin: ['accepted', 'completed'] },
    });
    if (!lead) {return next(createError(404, 'Lead not found.'));}
    const existing = await InstallerLead.findOne({ lead: lead._id, installer: installer._id });
    if (existing) {return next(createError(409, 'This installer has already received this lead.'));}
    const assignment = await InstallerLead.create({ lead: lead._id, installer: installer._id });
    lead.installerAssignment = { installer: installer._id, status: 'offered', assignedAt: new Date() };
    lead.status = 'assigned';
    await lead.save();
    await sendEmail(installer.email, 'A new installation lead is available', `A new ${lead.productType || 'installation'} lead is available in ${lead.region}. Sign in to your installer portal to respond.`, `installer-offer-${assignment._id}`);
    res.status(201).json({ success: true, data: assignment });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  searchInstallers,
  getInstallerProfile,
  getApplicationUploadUrl,
  submitInstallerApplication,
  myInstallerApplication,
  portalProfile,
  portalLeads,
  respondToLead,
  updateJobStatus,
  updateCoverage,
  certifiedDocuments,
  trackReferralClick,
  adminListInstallers,
  adminUpdateInstaller,
  adminLeadFlowStats,
  adminReferralConfigs,
  adminApplicationDocument,
  adminAssignLead,
};
