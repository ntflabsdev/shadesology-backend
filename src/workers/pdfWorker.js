'use strict';

/**
 * PDF Worker — processes 'generate-quote' jobs from the 'pdf' BullMQ queue.
 *
 * Generates a branded quote PDF and stores it in the private S3 bucket.
 * After generation the Quote document is updated with the S3 key.
 *
 * Uses only Node's built-in modules + aws-sdk for storage.
 * No external PDF library required — we generate HTML-to-text style PDF
 * using a simple, pure-JS approach that produces a clean, readable document.
 *
 * For a richer PDF (logos, styling), swap buildQuotePdf() for puppeteer or
 * pdfkit — the worker interface stays the same.
 */

const { Worker } = require('bullmq');
const { createRedisConnection, isRedisEnabled } = require('../config/redis');
const Quote = require('../models/Quote');
const s3    = require('../services/s3');

// ─── PDF builder (pure JS — no binary deps) ───────────────────────────────────

/**
 * Build a minimal but complete quote PDF as a Buffer.
 * Returns a well-structured plain-text PDF using a hand-rolled PDF writer.
 * Replace this function with puppeteer/pdfkit if richer styling is required.
 *
 * @param {object} quote  Populated Quote document (plain object)
 * @returns {Buffer}
 */
function buildQuotePdf(quote) {
  const lines = [];
  const add   = (...parts) => lines.push(parts.join(''));

  const fmt  = (n) => (n !== null && n !== undefined ? `$${(n / 100).toFixed(2)}` : 'TBC');
  const date  = (d) => d ? new Date(d).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }) : '';
  const contactName = quote.guestContact
    ? `${quote.guestContact.firstName} ${quote.guestContact.lastName}`
    : (quote.user ? `${quote.user.firstName || ''} ${quote.user.lastName || ''}`.trim() : 'Customer');
  const contactEmail = quote.guestContact?.email || quote.user?.email || '';

  // ── Title page block ────────────────────────────────────────────────────────
  add('SHADESOLOGY.COM');
  add('Custom Shade Products');
  add('');
  add('QUOTE DOCUMENT');
  add('------------------------------------------------------------------------');
  add('');
  add('Reference:    ', quote.referenceNumber);
  add('Date:         ', date(quote.createdAt));
  add('Valid Until:  ', date(quote.expiresAt));
  add('Status:       ', (quote.status || '').toUpperCase());
  add('');
  add('------------------------------------------------------------------------');
  add('CUSTOMER');
  add('------------------------------------------------------------------------');
  add('');
  add('Name:         ', contactName);
  add('Email:        ', contactEmail);
  if (quote.guestContact?.phone || quote.user?.phone) {
    add('Phone:        ', quote.guestContact?.phone || quote.user?.phone || '');
  }
  if (quote.guestContact?.company) {
    add('Company:      ', quote.guestContact.company);
  }
  add('');

  // ── Installation address ─────────────────────────────────────────────────
  const addr = quote.installationAddress;
  if (addr && addr.line1) {
    add('------------------------------------------------------------------------');
    add('INSTALLATION ADDRESS');
    add('------------------------------------------------------------------------');
    add('');
    add(addr.line1);
    add(`${addr.city || ''}, ${addr.state || ''} ${addr.zip || ''}`);
    add('');
  }

  // ── Project description ───────────────────────────────────────────────────
  if (quote.projectDescription) {
    add('------------------------------------------------------------------------');
    add('PROJECT DESCRIPTION');
    add('------------------------------------------------------------------------');
    add('');
    add(quote.projectDescription);
    add('');
  }

  // ── Line items ────────────────────────────────────────────────────────────
  add('------------------------------------------------------------------------');
  add('ITEMS');
  add('------------------------------------------------------------------------');
  add('');

  (quote.items || []).forEach((item, idx) => {
    add(`${idx + 1}. ${item.productName || 'Product'}${item.variantName ? ` - ${item.variantName}` : ''}`);
    if (item.sku)      add('   SKU:       ', item.sku);
    add('   Quantity:  ', String(item.quantity || 1));

    // Selected options
    const opts = item.selectedOptions || {};
    const optEntries = opts instanceof Map ? [...opts.entries()] : Object.entries(opts);
    if (optEntries.length > 0) {
      add('   Options:');
      optEntries.forEach(([k, v]) => add(`     * ${k}: ${v}`));
    }

    if (item.unitPrice  !== null && item.unitPrice !== undefined) add('   Unit Price: ', fmt(item.unitPrice));
    if (item.totalPrice !== null && item.totalPrice !== undefined) add('   Line Total: ', fmt(item.totalPrice));
    if (item.notes)              add('   Notes:      ', item.notes);
    add('');
  });

  // ── Pricing totals ────────────────────────────────────────────────────────
  if (quote.total !== null && quote.total !== undefined) {
    add('------------------------------------------------------------------------');
    add('PRICING');
    add('------------------------------------------------------------------------');
    add('');
    if (quote.subtotal !== null && quote.subtotal !== undefined) add('Subtotal:     ', fmt(quote.subtotal));
    if (quote.tax      !== null && quote.tax !== undefined) add('Tax:          ', fmt(quote.tax));
    add('TOTAL:        ', fmt(quote.total));
    add('Currency:     ', quote.currency || 'USD');
    if (quote.priceLocked) add('');
    add('');
    add('Note: This quote is valid until ', date(quote.expiresAt), '.');
    add('Prices are locked upon acceptance. Material prices may vary after expiry.');
  } else {
    add('Pricing will be provided by our team shortly.');
  }

  add('');
  add('------------------------------------------------------------------------');
  add('');
  add('Shadesology.com | Custom Shade Products');
  add(`Generated: ${date(new Date())}`);
  add('');

  const asciiLines = lines.flatMap((line) => wrapPdfLine(toPdfAscii(line), 96));
  const linesPerPage = 56;
  const pages = [];
  for (let offset = 0; offset < asciiLines.length; offset += linesPerPage) {
    pages.push(asciiLines.slice(offset, offset + linesPerPage));
  }

  const pageIds = pages.map((_, index) => 4 + index * 2);
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>';

  pages.forEach((pageLines, pageIndex) => {
    const pageId = pageIds[pageIndex];
    const contentId = pageId + 1;
    const commands = [
      'BT',
      '/F1 9 Tf',
      '40 752 Td',
      '12 TL',
      '0.105 0.263 0.196 rg',
      '(SHADESOLOGY.COM) Tj',
      '0 0 0 rg',
      'T*',
      `(Quote ${escapePdfText(quote.referenceNumber)} | Custom Shade Products) Tj`,
      'T*',
      'T*',
      ...pageLines.map((line) => `(${escapePdfText(line)}) Tj T*`),
      'ET',
      'BT',
      '/F1 8 Tf',
      '40 24 Td',
      `(Shadesology.com | Page ${pageIndex + 1} of ${pages.length}) Tj`,
      'ET',
    ].join('\n');
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(commands, 'ascii')} >>\nstream\n${commands}\nendstream`;
  });

  let pdf = '%PDF-1.4\n% Shadesology quote document\n';
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, 'ascii');
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'ascii');
}

function toPdfAscii(value) {
  return String(value)
    .replace(/[—–]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '?');
}

function wrapPdfLine(line, width) {
  if (!line) return [''];
  if (line.length <= width) return [line];
  const words = line.split(/\s+/);
  const wrapped = [];
  let current = '';
  for (const word of words) {
    if (word.length > width) {
      if (current) wrapped.push(current);
      for (let offset = 0; offset < word.length; offset += width) {
        wrapped.push(word.slice(offset, offset + width));
      }
      current = '';
    } else if (current && `${current} ${word}`.length > width) {
      wrapped.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) wrapped.push(current);
  return wrapped;
}

function escapePdfText(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

// ─── Worker processor ─────────────────────────────────────────────────────────

async function processor(job) {
  const { quoteId } = job.data;

  job.log(`Generating PDF for quote ${quoteId}`);

  const quote = await Quote.findById(quoteId)
    .populate('user', 'firstName lastName email phone')
    .populate('items.product', 'name')
    .populate('items.variant', 'name sku')
    .lean();

  if (!quote) throw new Error(`Quote ${quoteId} not found.`);

  const pdfBuffer = buildQuotePdf(quote);

  job.log(`PDF built — ${pdfBuffer.length} bytes. Uploading to S3 private bucket.`);

  const filename   = `quote-${quote.referenceNumber}.pdf`;
  const { key }    = await s3.uploadPrivate(
    pdfBuffer,
    'application/pdf',
    'quotes',
    quoteId,
    filename
  );

  // Update the quote with the new S3 key (overwrites previous version)
  await Quote.findByIdAndUpdate(quoteId, { pdfS3Key: key });

  job.log(`PDF stored at s3://private/${key}`);
  return { key };
}

// ─── Worker lifecycle ─────────────────────────────────────────────────────────

let _worker = null;

function start() {
  if (_worker) return _worker;

  if (!isRedisEnabled()) {
    console.info('[PdfWorker] Redis disabled — PDF worker not started.');
    return null;
  }

  const conn = createRedisConnection();
  if (!conn) return null;

  _worker = new Worker('pdf', processor, {
    connection:  conn,
    concurrency: 2,
  });

  _worker.on('completed', (job) => {
    console.info(`[PdfWorker] ✅ quote PDF job ${job.id} done — ${job.returnvalue?.key}`);
  });

  _worker.on('failed', (job, err) => {
    console.error(`[PdfWorker] ❌ job ${job?.id} failed: ${err.message}`);
  });

  _worker.on('error', () => {});

  console.info('[PdfWorker] started (concurrency: 2)');
  return _worker;
}

async function stop() {
  if (_worker) {
    await _worker.close();
    _worker = null;
    console.info('[PdfWorker] stopped.');
  }
}

module.exports = { start, stop, buildQuotePdf };
