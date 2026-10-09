const express = require('express');
const { optionalAuthenticate } = require('../middlewares/authenticate');
const { getProduct, listProducts } = require('../controllers/catalog/productController');

const router = express.Router();

// optionalAuthenticate — attaches req.user if cookie present (for dealer pricing)
// but does NOT block unauthenticated requests
router.get('/',       optionalAuthenticate, listProducts);
router.get('/:slug',  optionalAuthenticate, getProduct);

module.exports = router;
