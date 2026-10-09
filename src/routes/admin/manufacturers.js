const express = require('express');
const makeCrudController = require('../../controllers/admin/crudController');
const Manufacturer = require('../../models/Manufacturer');

const router = express.Router();
const ctrl = makeCrudController(Manufacturer, {
  searchFields: ['name', 'slug', 'country'],
  defaultSort: 'name',
});

router.get('/',              ctrl.list);
router.get('/:id',           ctrl.getOne);
router.post('/',             ctrl.create);
router.put('/:id',           ctrl.update);
router.patch('/:id/toggle',  ctrl.toggleActive);
router.delete('/:id',        ctrl.remove);

module.exports = router;
