const express = require('express');
const { authenticate } = require('../middlewares/authenticate');
const rateLimit = require('../middlewares/rateLimit');
const {
  submit,
  myApplications,
} = require('../controllers/admin/approvalController');

const router = express.Router();

// All approval routes require authentication
router.use(authenticate);

// ─── Applicant routes (any authenticated user) ────────────────────────────────
router.post(
  '/',
  rateLimit({ windowMs: 60_000, max: 5, keyPrefix: 'rl:approval-submit' }),
  (req, res, next) => {
    if (req.body?.faxNumber || req.body?.data?.faxNumber) {
      return res.status(202).json({ success: true, message: 'Application submitted.' });
    }
    next();
  },
  submit
);
router.get('/mine', myApplications);  // view own applications + status

module.exports = router;
