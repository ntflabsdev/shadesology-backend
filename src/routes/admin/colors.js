const express = require('express');
const makeCrudController = require('../../controllers/admin/crudController');
const Color = require('../../models/Color');

const router = express.Router();
const ctrl = makeCrudController(Color, {
  searchFields: ['name.en', 'code', 'slug'],
  defaultSort: 'sortOrder name.en',
});

router.get('/',              ctrl.list);
router.get('/:id',           ctrl.getOne);
router.post('/',             ctrl.create);
router.put('/:id',           ctrl.update);
router.patch('/:id/toggle',  ctrl.toggleActive);
router.delete('/:id',        ctrl.remove);

module.exports = router;
