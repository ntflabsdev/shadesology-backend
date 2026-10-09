'use strict';

const express = require('express');
const { deliveryEstimate } = require('../controllers/shippingController');

const router = express.Router();
router.get('/estimate', deliveryEstimate);

module.exports = router;
