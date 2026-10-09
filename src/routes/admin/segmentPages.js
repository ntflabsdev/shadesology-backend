const express = require('express');
const {
  adminList,
  adminGetOne,
  adminUpdate,
  adminSetStatus,
  adminUpsertBlock,
  adminDeleteBlock,
  adminReorderBlocks,
} = require('../../controllers/segments/segmentPageController');

const router = express.Router();

// All routes protected by requireStaff (applied in admin/index.js)

router.get('/',                               adminList);
router.get('/:id',                            adminGetOne);
router.put('/:id',                            adminUpdate);
router.patch('/:id/status',                   adminSetStatus);

// Content blocks
router.post('/:id/blocks',                    adminUpsertBlock);          // add block
router.put('/:id/blocks/:blockId',            adminUpsertBlock);          // update block
router.delete('/:id/blocks/:blockId',         adminDeleteBlock);          // delete block
router.patch('/:id/blocks/reorder',           adminReorderBlocks);        // reorder blocks

module.exports = router;
