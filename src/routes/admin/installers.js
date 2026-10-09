'use strict';

const express = require('express');
const {
  adminListInstallers,
  adminUpdateInstaller,
  adminLeadFlowStats,
  adminReferralConfigs,
  adminApplicationDocument,
  adminAssignLead,
} = require('../../controllers/installer/installerController');

const router = express.Router();

router.get('/referrals', adminReferralConfigs);
router.put('/referrals', adminReferralConfigs);
router.get('/lead-flow', adminLeadFlowStats);
router.post('/leads/:leadId/assign', adminAssignLead);
router.get('/applications/:id/documents/:index', adminApplicationDocument);
router.get('/', adminListInstallers);
router.patch('/:id', adminUpdateInstaller);

module.exports = router;
