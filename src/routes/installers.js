'use strict';

const express = require('express');
const rateLimit = require('../middlewares/rateLimit');
const { authenticate } = require('../middlewares/authenticate');
const { requireRole } = require('../middlewares/requireRole');
const {
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
} = require('../controllers/installer/installerController');

const router = express.Router();

/**
 * GET /api/installers/search?postcode=33101  — search by postcode or city
 * GET /api/installers/:slug                  — get installer profile
 */
router.get(
  '/search',
  rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'rl:installer-search' }),
  searchInstallers
);

router.post(
  '/application-upload-url',
  authenticate,
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'rl:installer-document-upload' }),
  getApplicationUploadUrl,
);
router.post(
  '/apply',
  authenticate,
  rateLimit({ windowMs: 60_000, max: 3, keyPrefix: 'rl:installer-application' }),
  submitInstallerApplication,
);
router.get('/application/mine', authenticate, myInstallerApplication);
router.post('/referrals/:region/click', trackReferralClick);

router.use('/portal', authenticate, requireRole('installer'));
router.get('/portal/profile', portalProfile);
router.get('/portal/leads', portalLeads);
router.patch('/portal/leads/:id/respond/:action', respondToLead);
router.patch('/portal/leads/:id/status', updateJobStatus);
router.put('/portal/coverage', updateCoverage);
router.get('/portal/documents', certifiedDocuments);

router.get('/:slug', getInstallerProfile);

module.exports = router;
