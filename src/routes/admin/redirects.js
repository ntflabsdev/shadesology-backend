const express = require('express');
const makeCrudController = require('../../controllers/admin/crudController');
const Redirect = require('../../models/Redirect');

const router = express.Router();
const ctrl = makeCrudController(Redirect, {
  searchFields: ['from', 'to', 'reason'],
  defaultSort: 'from',
});

router.get('/',              ctrl.list);
router.get('/:id',           ctrl.getOne);
router.post('/',             ctrl.create);
router.put('/:id',           ctrl.update);
router.patch('/:id/toggle',  ctrl.toggleActive);
router.delete('/:id',        ctrl.remove);

module.exports = router;
