'use strict';

const express = require('express');
const { crmDashboard, getCrmConfig, updateCrmConfig } = require('../../controllers/admin/crmController');
const { requireStaffRole } = require('../../middlewares/requireRole');

const router = express.Router();
router.use(requireStaffRole('admin'));
router.get('/', crmDashboard);
router.get('/config', getCrmConfig);
router.put('/config', updateCrmConfig);

module.exports = router;
