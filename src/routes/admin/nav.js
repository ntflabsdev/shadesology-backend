const express = require('express');
const { adminGetMenu, adminUpsertMenu } = require('../../controllers/nav/navController');

const router = express.Router();

router.get('/:type',  adminGetMenu);    // GET /admin/nav/main
router.put('/:type',  adminUpsertMenu); // PUT /admin/nav/main  (upsert full menu)

module.exports = router;
