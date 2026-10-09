const express = require('express');
const makeCrudController = require('../../controllers/admin/crudController');
const OptionGroup = require('../../models/OptionGroup');

const router = express.Router();
const ctrl = makeCrudController(OptionGroup, {
  searchFields: ['name.en', 'slug'],
  populateFields: ['productTypes', 'options.color'],
  defaultSort: 'sortOrder',
});

router.get('/',              ctrl.list);
router.get('/:id',           ctrl.getOne);
router.post('/',             ctrl.create);
router.put('/:id',           ctrl.update);
router.patch('/:id/toggle',  ctrl.toggleActive);
router.delete('/:id',        ctrl.remove);

module.exports = router;
