const express = require('express');
const { getCollection, getGlobal } = require('../controllers/payloadContentController');

const router = express.Router();

router.get('/collections/:slug', getCollection);
router.get('/globals/:slug', getGlobal);

module.exports = router;
