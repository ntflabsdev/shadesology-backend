const express = require('express');
const makeCrudController = require('../../controllers/admin/crudController');
const Video = require('../../models/Video');

const router = express.Router();
const ctrl = makeCrudController(Video, {
  searchFields: ['videoUrl', 'title.en', 'category'],
  defaultSort: 'sortOrder createdAt',
});

router.get('/', ctrl.list);
router.get('/:id', ctrl.getOne);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.patch('/:id/toggle', ctrl.toggleActive);
router.delete('/:id', ctrl.remove);

module.exports = router;
