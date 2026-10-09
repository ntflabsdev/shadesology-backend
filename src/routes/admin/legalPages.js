const express = require('express');
const {
  adminList,
  adminCreate,
  adminUpdate,
  adminDelete,
} = require('../../controllers/content/legalController');

const router = express.Router();

router.get('/',      adminList);
router.post('/',     adminCreate);
router.put('/:id',   adminUpdate);
router.delete('/:id',adminDelete);

module.exports = router;
