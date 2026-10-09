'use strict';

const express = require('express');
const { optionalAuthenticate } = require('../middlewares/authenticate');
const { compare } = require('../controllers/comparison/comparisonController');

const router = express.Router();

router.get('/', optionalAuthenticate, compare);

module.exports = router;
