'use strict';

const express = require('express');
const {
  adminListShippingRates,
  adminCreateShippingRate,
  adminUpdateShippingRate,
  adminDeleteShippingRate,
} = require('../../controllers/shippingController');

const router = express.Router();
router.get('/', adminListShippingRates);
router.post('/', adminCreateShippingRate);
router.patch('/:id', adminUpdateShippingRate);
router.delete('/:id', adminDeleteShippingRate);

module.exports = router;
