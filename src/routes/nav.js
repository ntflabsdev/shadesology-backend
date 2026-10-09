const express = require('express');
const { getMainNav, getMobileNav } = require('../controllers/nav/navController');

const router = express.Router();

router.get('/main',   getMainNav);
router.get('/mobile', getMobileNav);

module.exports = router;
