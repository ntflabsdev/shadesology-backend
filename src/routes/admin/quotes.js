'use strict';

const express = require('express');
const {
  adminListQuotes,
  adminGetQuote,
  adminUpdateQuote,
  adminConvertQuoteToOrder,
  adminGenerateQuotePdf,
  adminGetQuotePdfUrl,
  adminGetQuoteAttachmentUrl,
  adminListStaff,
} = require('../../controllers/quote/quoteController');

const router = express.Router();

// All routes here are already guarded by requireStaff (applied in admin/index.js)

router.get('/',                    adminListQuotes);
router.get('/staff',               adminListStaff);
router.get('/:id',                 adminGetQuote);
router.get('/:id/attachments/:attachmentId/url', adminGetQuoteAttachmentUrl);
router.patch('/:id',               adminUpdateQuote);
router.post('/:id/convert-to-order', adminConvertQuoteToOrder);
router.post('/:id/generate-pdf',   adminGenerateQuotePdf);
router.get('/:id/pdf-url',         adminGetQuotePdfUrl);

module.exports = router;
