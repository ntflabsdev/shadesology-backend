const ApprovalRequest = require('../../models/ApprovalRequest');
const User = require('../../models/User');
const Company = require('../../models/Company');
const Installer = require('../../models/Installer');
const AuditLog = require('../../models/AuditLog');
const { createError } = require('../../middlewares/errorHandler');
const { getQueue } = require('../../queues');
const { resolveLeadRecipient } = require('../../services/leadRouting');
const { installerSlug } = require('../../services/installerNetwork');
const hubspot = require('../../services/hubspot');

async function queueApplicantEmail(applicant, subject, text, jobId, delay = 0) {
  if (!applicant?.email) {return;}
  try {
    await getQueue('email').add('send', { to: applicant.email, subject, text }, { jobId, delay });
  } catch (err) {
    console.error('[Approval] Applicant notification failed; decision remains stored:', err.message);
  }
}

function onboardingMessages(request) {
  const reference = request.referenceNumber;
  return [
    { delay: 0, subject: 'Welcome to the Shadesology installer network', text: `Your installer application ${reference} has been approved. Sign in to review installation opportunities and keep your service area current.` },
    { delay: 24 * 60 * 60 * 1000, subject: 'Getting started as a Shadesology installer', text: `Your installer profile is ready. Review your coverage area, product certifications and available installation leads in your portal.` },
    { delay: 3 * 24 * 60 * 60 * 1000, subject: 'Your installer portal checklist', text: `Complete your installer portal profile and review the technical resources available for products you are certified to install.` },
  ];
}

// ─── Submit application (customer-facing) ────────────────────────────────────
/**
 * POST /api/approvals
 * Any logged-in user can submit an application.
 * Pricing tier change requires staff — handled separately via admin route.
 */
const submit = async (req, res, next) => {
  try {
    const { type, data, documents } = req.body;

    const allowedTypes = [
      'installer_application',
      'dealer_application',
      'specifier_application',
      'trade_application',
    ];

    if (!allowedTypes.includes(type)) {
      return next(createError(400, `Invalid application type. Allowed: ${allowedTypes.join(', ')}`));
    }
    if (type === 'installer_application') {
      return next(createError(400, 'Submit installer applications through POST /api/installers/apply.'));
    }

    // Prevent duplicate pending applications
    const existing = await ApprovalRequest.findOne({
      applicant: req.user._id,
      type,
      status: { $in: ['pending', 'in_review'] },
    });

    if (existing) {
      return next(createError(409, `You already have a pending ${type.replace(/_/g, ' ')} (ref: ${existing.referenceNumber}).`));
    }

    const request = await ApprovalRequest.create({
      type,
      applicant: req.user._id,
      company: req.user.company || null,
      data: data || {},
      documents: documents || [],
    });
    await hubspot.enqueueSync('application', request._id.toString());

    const enquiryType = type === 'installer_application' ? 'installer' : 'dealer';
    let notificationEmail = '';
    try {
      notificationEmail = await resolveLeadRecipient({
        enquiryType,
        productType: String(data?.productsOfInterest || ''),
        region: String(data?.state || data?.city || ''),
      });
    } catch (err) {
      console.error('[Approval] Could not resolve notification route; application remains stored:', err.message);
    }
    const enqueue = async (jobId, payload) => {
      try {
        await getQueue('email').add('send', payload, { jobId });
      } catch (err) {
        console.error('[Approval] Notification enqueue failed; application remains stored:', err.message);
      }
    };
    const applicantEmail = req.user.email;
    if (notificationEmail) {
      await enqueue(`approval-staff-${request._id}`, {
        to: notificationEmail,
        subject: `${type.replace(/_/g, ' ')} received (${request.referenceNumber})`,
        text: `${type.replace(/_/g, ' ')} received from ${req.user.firstName || ''} ${req.user.lastName || ''} (${applicantEmail || 'no email'})\nReference: ${request.referenceNumber}\nRegion: ${data?.state || data?.city || ''}\nProduct interest: ${data?.productsOfInterest || ''}`,
      });
    } else {
      console.error('[Approval] No staff notification recipient configured; application remains stored:', String(request._id));
    }
    if (applicantEmail) {
      await enqueue(`approval-applicant-${request._id}`, {
        to: applicantEmail,
        subject: 'We received your application',
        text: `Thank you. Your ${type.replace(/_/g, ' ')} has been received and is awaiting review.\nReference: ${request.referenceNumber}`,
      });
    }

    res.status(201).json({
      success: true,
      message: 'Application submitted. You will be notified by email when it is reviewed.',
      referenceNumber: request.referenceNumber,
      data: request,
    });
  } catch (err) {
    next(err);
  }
};

// ─── My applications (customer-facing) ───────────────────────────────────────
const myApplications = async (req, res, next) => {
  try {
    const requests = await ApprovalRequest.find({ applicant: req.user._id })
      .sort('-createdAt')
      .select('-documents.fileUrl -documents.contentType -documents.sizeBytes -resolution')
      .lean();

    res.json({ success: true, data: requests });
  } catch (err) {
    next(err);
  }
};

// ─── List all (staff only) ────────────────────────────────────────────────────
const list = async (req, res, next) => {
  try {
    const {
      status,
      type,
      assignedTo,
      page = 1,
      limit = 25,
    } = req.query;

    const filter = {};
    if (status)     filter.status = status;
    if (type)       filter.type = type;
    if (assignedTo) filter.assignedTo = assignedTo;

    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, parseInt(limit, 10));
    const skip     = (pageNum - 1) * limitNum;

    const [docs, total] = await Promise.all([
      ApprovalRequest.find(filter)
        .populate('applicant', 'firstName lastName email role')
        .populate('assignedTo', 'firstName lastName email')
        .populate('company', 'name type')
        .sort('-createdAt')
        .skip(skip)
        .limit(limitNum)
        .lean(),
      ApprovalRequest.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: docs,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Assign to staff member ───────────────────────────────────────────────────
const assign = async (req, res, next) => {
  try {
    const { staffId } = req.body;
    if (!staffId) return next(createError(400, 'staffId is required.'));

    const staffMember = await User.findById(staffId);
    if (!staffMember || staffMember.role !== 'staff') {
      return next(createError(400, 'Target user must be a staff member.'));
    }

    const request = await ApprovalRequest.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          assignedTo: staffId,
          assignedAt: new Date(),
          status: 'in_review',
        },
      },
      { new: true }
    ).populate('applicant', 'firstName lastName email');

    if (!request) return next(createError(404, 'Application not found.'));

    res.json({ success: true, data: request });
  } catch (err) {
    next(err);
  }
};

// ─── Approve ──────────────────────────────────────────────────────────────────
const approve = async (req, res, next) => {
  try {
    const { resolution, roleGranted, pricingGroupGranted } = req.body;

    const request = await ApprovalRequest.findById(req.params.id)
      .populate('applicant');

    if (!request) {return next(createError(404, 'Application not found.'));}
    if (!request.applicant) {return next(createError(404, 'The applicant account no longer exists.'));}
    if (request.status === 'approved') {
      return next(createError(409, 'Application is already approved.'));
    }
    const installerData = request.type === 'installer_application' ? request.data || {} : null;
    if (installerData) {
      const insuranceExpiry = new Date(installerData.insuranceExpiry);
      const coverageAreas = Array.isArray(installerData.coverageAreas) ? installerData.coverageAreas : [];
      if (!installerData.businessName || !installerData.city || !installerData.state ||
        !installerData.licenseNumber || !installerData.insuranceProvider ||
        !Number.isFinite(Number(installerData.yearsExperience)) || Number(installerData.yearsExperience) < 0 ||
        Number(installerData.yearsExperience) > 100 || coverageAreas.length === 0 ||
        coverageAreas.some((area) => !area.postcode || !Number.isFinite(Number(area.radiusMiles)) ||
          Number(area.radiusMiles) < 1 || Number(area.radiusMiles) > 500 ||
          (area.lat !== undefined && (!Number.isFinite(Number(area.lat)) || Number(area.lat) < -90 || Number(area.lat) > 90)) ||
          (area.lng !== undefined && (!Number.isFinite(Number(area.lng)) || Number(area.lng) < -180 || Number(area.lng) > 180)) ||
          ((area.lat === undefined) !== (area.lng === undefined))) ||
        Number.isNaN(insuranceExpiry.getTime()) || insuranceExpiry <= new Date()) {
        return next(createError(400, 'The installer application is incomplete or its insurance has expired.'));
      }
    }

    // Apply role and/or pricing group changes to the user
    const userUpdates = {};
    const grantedRole = roleGranted || (request.type === 'installer_application' ? 'installer' : '');
    if (grantedRole)         userUpdates.role = grantedRole;
    if (pricingGroupGranted) userUpdates.pricingGroup = pricingGroupGranted;

    // Pricing group ONLY via staff approval — enforced here
    if (pricingGroupGranted) {
      userUpdates.pricingGroup = pricingGroupGranted;
    }

    if (Object.keys(userUpdates).length > 0) {
      await User.findByIdAndUpdate(request.applicant._id, { $set: userUpdates });
    }

    if (request.type === 'installer_application') {
      const data = installerData;
      const coverageAreas = Array.isArray(data.coverageAreas) ? data.coverageAreas : [];
      const existingProfile = await Installer.findOneAndUpdate(
        { user: request.applicant._id },
        {
          $set: {
            businessName: data.businessName,
            slug: installerSlug(data.businessName, request.applicant._id),
            contactName: data.contactName,
            email: request.applicant.email,
            phone: data.phone || request.applicant.phone,
            address: { city: data.city, state: data.state, country: 'US' },
            coverageAreas,
            licenseNumber: data.licenseNumber,
            licenseExpiry: data.licenseExpiry || null,
            insuranceProvider: data.insuranceProvider,
            insuranceExpiry: data.insuranceExpiry,
            yearsExperience: data.yearsExperience,
            specialities: Array.isArray(data.specialities) ? data.specialities : [],
            description: data.description || '',
            privateDocuments: (request.documents || []).map((document) => ({
              label: document.label,
              key: document.fileUrl,
              contentType: document.contentType,
              sizeBytes: document.sizeBytes,
            })),
            status: 'approved',
            isActive: true,
            isVerified: true,
          },
        },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      );
      if (!existingProfile) throw new Error('Approved installer profile could not be created.');
    }

    // If company-level approval, update company too
    if (request.company && pricingGroupGranted) {
      await Company.findByIdAndUpdate(request.company, {
        $set: { pricingGroup: pricingGroupGranted, isApproved: true, approvedAt: new Date(), approvedBy: req.user._id },
      });
    }

    // Update the request itself
    request.status = 'approved';
    request.resolvedBy = req.user._id;
    request.resolvedAt = new Date();
    request.resolution = resolution || '';
    request.outcome = {
      roleGranted: grantedRole || '',
      pricingGroupGranted: pricingGroupGranted || '',
    };
    await request.save();

    await AuditLog.record({
      event: 'approval_resolved',
      actor: req.user._id,
      actorEmail: req.user.email,
      subject: request.applicant._id,
      subjectEmail: request.applicant.email,
      meta: { requestId: request._id, outcome: 'approved', roleGranted, pricingGroupGranted },
      ip: req.ip,
    });

    if (request.type === 'installer_application') {
      for (const [index, email] of onboardingMessages(request).entries()) {
        await queueApplicantEmail(
          request.applicant,
          email.subject,
          email.text,
          `installer-onboarding-${request._id}-${index + 1}`,
          email.delay,
        );
      }
    } else {
      await queueApplicantEmail(
        request.applicant,
        'Your application has been approved',
        `Your ${request.type.replace(/_/g, ' ')} application ${request.referenceNumber} has been approved.`,
        `approval-result-${request._id}`,
      );
    }

    res.json({ success: true, data: request });
  } catch (err) {
    next(err);
  }
};

// ─── Reject ───────────────────────────────────────────────────────────────────
const reject = async (req, res, next) => {
  try {
    const { resolution } = req.body;

    const request = await ApprovalRequest.findById(req.params.id)
      .populate('applicant', 'firstName lastName email role');

    if (!request) return next(createError(404, 'Application not found.'));
    if (['approved', 'rejected'].includes(request.status)) {
      return next(createError(409, `Application is already ${request.status}.`));
    }

    request.status = 'rejected';
    request.resolvedBy = req.user._id;
    request.resolvedAt = new Date();
    request.resolution = resolution || '';
    await request.save();

    await AuditLog.record({
      event: 'approval_resolved',
      actor: req.user._id,
      actorEmail: req.user.email,
      subject: request.applicant._id,
      subjectEmail: request.applicant.email,
      meta: { requestId: request._id, outcome: 'rejected' },
      ip: req.ip,
    });

    await queueApplicantEmail(
      request.applicant,
      'Your application has been reviewed',
      `Your ${request.type.replace(/_/g, ' ')} application ${request.referenceNumber} was not approved.${resolution ? `\n\nNote: ${resolution}` : ''}`,
      `approval-result-${request._id}`,
    );

    res.json({ success: true, data: request });
  } catch (err) {
    next(err);
  }
};

module.exports = { submit, myApplications, list, assign, approve, reject };
