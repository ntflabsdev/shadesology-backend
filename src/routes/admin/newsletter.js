const express = require('express');
const { adminList } = require('../../controllers/content/newsletterController');

const router = express.Router();

router.get('/', adminList); // list subscribers with status filter

module.exports = router;
