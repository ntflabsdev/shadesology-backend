'use strict';

const { randomUUID } = require('node:crypto');
const Lead = require('../../models/Lead');
const WarrantyRegistration = require('../../models/WarrantyRegistration');
const { createError } = require('../../middlewares/errorHandler');
const { getQueue } = require('../../queues');
const { resolveLeadRecipient } = require('../../services/leadRouting');
const { persistBeforeNotify } = require('../../services/leadSubmission');
const { offerNextInstaller } = require('../../services/installerNetwork');
const s3 = require('../../services/s3');
const hubspot = require('../../services/hubspot');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SERVICE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const SERVICE_UPLOAD_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
const COMMERCIAL_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
const COMMERCIAL_UPLOAD_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
  'application/acad',
  'image/vnd.dwg',
  'image/vnd.dxf',
  'application/dxf',
  'application/octet-stream',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function text(value, max = 2000) {
  return typeof value === 'string' ? value.replace(/\p{Cc}/gu, ' ').trim().slice(0, max) : '';
}

async function getCommercialUploadUrl(req, res, next) {
  try {
    const { filename, contentType, sizeBytes } = req.body || {};
    const mimeType = typeof contentType === 'string' ? contentType.split(';')[0].trim().toLowerCase() : '';
    const size = Number(sizeBytes);
    if (!filename || typeof filename !== 'string' || !COMMERCIAL_UPLOAD_TYPES.has(mimeType)) {
      return next(createError(400, 'A filename and supported drawing or image type are required.'));
    }
    if (!Number.isSafeInteger(size) || size < 1 || size > COMMERCIAL_UPLOAD_MAX_BYTES) {
      return next(createError(400, 'Project files must be between 1 byte and 100 MB.'));
    }
    const { key, uploadUrl, fields } = await s3.getSignedUploadUrl(
      'private',
      'commercial-projects',
      'pending',
      `${randomUUID()}-${filename}`,
      mimeType,
      COMMERCIAL_UPLOAD_MAX_BYTES,
      900
    );
    res.json({ success: true, data: { key, uploadUrl, fields, expiresInSeconds: 900 } });
  } catch (err) {
    next(err);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function contextData(input) {
  const context = input && typeof input === 'object' ? input : {};
  let pageUrl = '';
  if (typeof context.pageUrl === 'string') {
    try {
      const supplied = new URL(context.pageUrl);
      const configuredOrigin = new URL(process.env.FRONTEND_URL || 'http://localhost:3000').origin;
      pageUrl = supplied.origin === configuredOrigin ? `${supplied.origin}${supplied.pathname}` : '';
    } catch {
      pageUrl = '';
    }
  }
  return {
    pageUrl: pageUrl.slice(0, 2048),
    cartValue: Number.isFinite(Number(context.cartValue)) && Number(context.cartValue) >= 0 ? Number(context.cartValue) : undefined,
    cartItems: Number.isInteger(Number(context.cartItems)) && Number(context.cartItems) >= 0 ? Number(context.cartItems) : undefined,
  };
}

async function sendLeadEmails(lead) {
  if (['quote', 'service_request'].includes(lead.enquiryType) && lead.productType && lead.region) {
    try {
      await offerNextInstaller(lead._id);
    } catch (err) {
      console.error('[Lead] Installer routing failed; central lead remains stored:', err.message);
    }
  }
  let recipient;
  try {
    recipient = await resolveLeadRecipient(lead);
  } catch (err) {
    console.error('[Lead] Could not resolve lead notification recipient:', err.message);
  }
  const enqueue = async (name, payload, jobId) => {
    try {
      await getQueue('email').add(name, payload, { jobId });
    } catch (err) {
      console.error(`[Lead] ${name} enqueue failed; lead remains stored:`, err.message);
    }
  };
  if (recipient) {
    await enqueue('send', {
      to: recipient,
      subject: `${lead.enquiryType.replaceAll('_', ' ')} lead — ${lead.name}`,
      text: `New ${lead.enquiryType} lead\nName: ${lead.name}\nEmail: ${lead.email}\nPhone: ${lead.phone}\nProduct: ${lead.productType}\nEnquiry: ${lead.issueType}\nRegion: ${lead.region}\nPage: ${lead.context?.pageUrl || ''}\nCart value: ${lead.context?.cartValue ?? ''}\nCart item count: ${lead.context?.cartItems ?? ''}\nMessage: ${lead.message}\nLead ID: ${lead._id}`,
      html: `<p>New ${escapeHtml(lead.enquiryType.replaceAll('_', ' '))} lead</p><p>Name: ${escapeHtml(lead.name)}<br>Email: ${escapeHtml(lead.email)}<br>Phone: ${escapeHtml(lead.phone)}<br>Product: ${escapeHtml(lead.productType)}<br>Enquiry: ${escapeHtml(lead.issueType)}<br>Region: ${escapeHtml(lead.region)}<br>Page: ${escapeHtml(lead.context?.pageUrl || '')}<br>Cart value: ${escapeHtml(lead.context?.cartValue ?? '')}<br>Cart item count: ${escapeHtml(lead.context?.cartItems ?? '')}</p><p>${escapeHtml(lead.message)}</p><p>Lead ID: ${escapeHtml(lead._id)}</p>`,
    }, `lead-staff-${lead._id}`);
  } else {
    console.error('[Lead] No staff notification recipient configured; lead remains stored:', String(lead._id));
  }
  await enqueue('send', {
    to: lead.email,
    subject: 'We received your message',
    text: `Hi ${lead.name},\n\nThank you for contacting Shadesology. We received your ${lead.enquiryType.replaceAll('_', ' ')} and our team will follow up.\n\nReference: ${lead._id}`,
    html: `<p>Hi ${escapeHtml(lead.name)},</p><p>Thank you for contacting Shadesology. We received your ${escapeHtml(lead.enquiryType.replaceAll('_', ' '))} and our team will follow up.</p><p>Reference: ${escapeHtml(lead._id)}</p>`,
  }, `lead-auto-${lead._id}`);
  if (recipient) {
    try {
      lead.routedTo = recipient;
      await lead.save();
    } catch (err) {
      console.error('[Lead] Could not persist recipient routing; lead remains stored:', err.message);
    }
  }
}

async function submitLead(req, res, next) {
  try {
    const body = req.body || {};
    const applicationData = body.data && typeof body.data === 'object' ? body.data : {};
    if (text(body.website, 300) || text(body.faxNumber, 300) ||
      text(applicationData.website, 300) || text(applicationData.faxNumber, 300)) {
      return res.status(202).json({ success: true, message: 'Thank you. Your message has been received.' });
    }
    const name = text(body.name || applicationData.contactName || [body.firstName || applicationData.firstName, body.lastName || applicationData.lastName].filter(Boolean).join(' '), 201);
    const email = text(body.email || applicationData.email, 254).toLowerCase();
    const enquiryType = text(body.type || body.enquiryType || 'contact', 40);
    const parsedInstallDate = body.installDate ? new Date(body.installDate) : null;
    if (parsedInstallDate && (Number.isNaN(parsedInstallDate.getTime()) || parsedInstallDate > new Date())) {
      return next(createError(400, 'installDate must be a valid date that is not in the future.'));
    }
    const detailFields = ['businessName', 'businessType', 'abn', 'annualVolume', 'productsOfInterest', 'additionalNotes', 'city', 'state', 'coverageZips', 'licenseNumber', 'yearsExperience', 'description', 'budget', 'timeline', 'installationType', 'address', 'notes', 'projectDescription', 'projectType', 'audience'];
    const cleanApplicationData = Object.fromEntries(detailFields
      .filter((field) => applicationData[field] !== undefined)
      .map((field) => [field, text(applicationData[field], field === 'description' || field === 'additionalNotes' ? 5000 : 500)]));
    const message = text(body.message || body.description || applicationData.projectDescription || applicationData.additionalNotes || applicationData.description || applicationData.notes ||
      `${enquiryType.replaceAll('_', ' ')} application from ${applicationData.businessName || name}; business type ${applicationData.businessType || 'not specified'}; region ${applicationData.state || applicationData.city || 'not specified'}.`, 10000);
    if (name.length < 2 || !EMAIL_RE.test(email) || message.length < 10) {
      return next(createError(400, 'A name, valid email address, and message of at least 10 characters are required.'));
    }
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (attachments.length > (enquiryType === 'commercial_project' ? 10 : 5)) {
      return next(createError(400, enquiryType === 'commercial_project'
        ? 'A maximum of ten project files may be attached.'
        : 'A maximum of five photos may be attached.'));
    }
    const isCommercialProject = enquiryType === 'commercial_project';
    const resolvedAttachments = await Promise.all(attachments.map(async (attachment) => {
      const key = typeof attachment?.s3Key === 'string' ? attachment.s3Key : '';
      const expectedPrefix = `${process.env.NODE_ENV || 'development'}/${isCommercialProject ? 'commercial-projects' : 'service-requests'}/pending/`;
      if (!key.startsWith(expectedPrefix)) {throw createError(400, 'One or more attachments are invalid.');}
      const file = await s3.headFile(key, 'private');
      const allowedTypes = isCommercialProject ? COMMERCIAL_UPLOAD_TYPES : SERVICE_UPLOAD_TYPES;
      const maxBytes = isCommercialProject ? COMMERCIAL_UPLOAD_MAX_BYTES : SERVICE_UPLOAD_MAX_BYTES;
      if (!file.exists || !allowedTypes.has(file.contentType) ||
        !Number.isSafeInteger(file.contentLength) || file.contentLength < 1 || file.contentLength > maxBytes) {
        throw createError(400, 'An attachment has an unsupported type or size.');
      }
      return {
        s3Key: key,
        filename: s3.sanitiseFilename(text(attachment.filename, 180) || (isCommercialProject ? 'project-file' : 'service-photo')),
        contentType: file.contentType,
        sizeBytes: file.contentLength,
      };
    }));
    if (new Set(resolvedAttachments.map((file) => file.s3Key)).size !== resolvedAttachments.length) {
      return next(createError(400, 'Duplicate attachments are not allowed.'));
    }
    const validTypes = ['contact', 'quote', 'service_request', 'chat', 'commercial_lease', 'commercial_project', 'dealer', 'installer'];
    if (!validTypes.includes(enquiryType)) {return next(createError(400, 'Unsupported enquiry type.'));}
    const leadData = {
      enquiryType,
      name,
      email,
      phone: text(body.phone || applicationData.phone, 40),
      company: text(body.company || applicationData.businessName, 200),
      subject: text(body.subject, 200),
      issueType: text(body.issueType || body.enquiryType, 100),
      message,
      productType: text(body.productType || applicationData.productsOfInterest, 100),
      region: text(body.region || body.state || body.zip || applicationData.state || applicationData.city, 100),
      orderNumber: text(body.orderNumber, 100),
      installDate: parsedInstallDate,
      attachments: resolvedAttachments,
      context: contextData(body.context),
      source: text(body.source, 100) || 'website',
      applicationData: Object.keys(cleanApplicationData).length ? cleanApplicationData : undefined,
      ip: text(req.ip, 64),
    };
    const lead = await persistBeforeNotify(
      () => Lead.create(leadData),
      sendLeadEmails
    );
    await hubspot.enqueueSync('lead', lead._id.toString());
    res.status(201).json({ success: true, message: 'Thank you. Your message has been received.', data: { reference: lead._id } });
  } catch (err) {
    next(err);
  }
}

async function getChatStatus(req, res, next) {
  try {
    const { getBusinessHoursStatus } = require('../../services/chat');
    res.json({ success: true, data: getBusinessHoursStatus(new Date()) });
  } catch (err) {
    next(err);
  }
}

async function getServiceUploadUrl(req, res, next) {
  try {
    const { filename, contentType, sizeBytes } = req.body || {};
    const mimeType = typeof contentType === 'string' ? contentType.split(';')[0].trim().toLowerCase() : '';
    const size = Number(sizeBytes);
    if (!filename || typeof filename !== 'string' || !SERVICE_UPLOAD_TYPES.has(mimeType)) {
      return next(createError(400, 'A filename and supported image type (JPEG, PNG, WebP, HEIC) are required.'));
    }
    if (!Number.isSafeInteger(size) || size < 1 || size > SERVICE_UPLOAD_MAX_BYTES) {
      return next(createError(400, 'Service photos must be between 1 byte and 10 MB.'));
    }
    const { key, uploadUrl, fields } = await s3.getSignedUploadUrl(
      'private',
      'service-requests',
      'pending',
      `${randomUUID()}-${filename}`,
      mimeType,
      SERVICE_UPLOAD_MAX_BYTES,
      900
    );
    res.json({ success: true, data: { key, uploadUrl, fields, expiresInSeconds: 900 } });
  } catch (err) {
    next(err);
  }
}

async function registerWarranty(req, res, next) {
  try {
    const body = req.body || {};
    if (text(body.website, 300)) {return res.status(202).json({ success: true, message: 'Thank you. Your registration has been received.' });}
    const name = text(body.name || [body.firstName, body.lastName].filter(Boolean).join(' '), 201);
    const email = text(body.email, 254).toLowerCase();
    const installDate = new Date(body.installDate);
    if (name.length < 2 || !EMAIL_RE.test(email) || !text(body.model, 200) || !text(body.productType, 100) ||
      Number.isNaN(installDate.getTime()) || installDate > new Date()) {
      return next(createError(400, 'Name, valid email, product type, model, and a valid past installation date are required.'));
    }
    const registration = await WarrantyRegistration.create({
      name, email, phone: text(body.phone, 40), productType: text(body.productType, 100),
      model: text(body.model, 200), serialNumber: text(body.serialNumber, 100),
      orderNumber: text(body.orderNumber, 100), installDate,
    });
    const lead = await Lead.create({
      enquiryType: 'warranty_registration', name, email,
      phone: text(body.phone, 40), subject: `Warranty registration — ${body.model}`,
      message: `Warranty registration ${registration._id}; product ${text(body.productType, 100)}, model ${text(body.model, 200)}, installation date ${installDate.toISOString()}.`,
      productType: text(body.productType, 100), orderNumber: text(body.orderNumber, 100),
    });
    await hubspot.enqueueSync('lead', lead._id.toString());
    await sendLeadEmails(lead);
    res.status(201).json({ success: true, message: 'Your warranty registration has been received.', data: { reference: registration._id } });
  } catch (err) {
    next(err);
  }
}

module.exports = { submitLead, getChatStatus, getServiceUploadUrl, getCommercialUploadUrl, registerWarranty };
