const express = require('express');
const { adminGetContent, adminUpsertContent } = require('../../controllers/catalog/productController');

const router = express.Router();

router.get('/:productId',  adminGetContent);
router.put('/:productId',  adminUpsertContent);

module.exports = router;
