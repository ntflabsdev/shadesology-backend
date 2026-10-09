const express = require('express');
const { getFooter } = require('../controllers/footer/footerController');

const router = express.Router();

router.get('/', getFooter);

module.exports = router;
