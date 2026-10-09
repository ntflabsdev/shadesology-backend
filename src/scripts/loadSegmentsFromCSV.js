#!/usr/bin/env node
/**
 * Bulk Segment Page Loader from CSV
 * ──────────────────────────────────
 * Usage:
 *   node src/scripts/loadSegmentsFromCSV.js --file=./data/segments.csv
 *   node src/scripts/loadSegmentsFromCSV.js --file=./data/segments.csv --dry-run
 *
 * CSV format (required columns):
 *   segment_code, hero_headline_en, hero_subheadline_en, hero_image_url,
 *   hero_cta_label_en, hero_cta_url,
 *   meta_title_en, meta_description_en, status
 *
 * Optional columns:
 *   hero_headline_es, hero_headline_de, hero_headline_fr, hero_headline_it, hero_headline_pt
 *   (same pattern for hero_subheadline_*, meta_title_*, meta_description_*)
 *
 * The script:
 *   1. Reads + validates the CSV
 *   2. Matches each row to an existing Segment by code
 *   3. Upserts a SegmentPage (creates or updates — never duplicates)
 *   4. In --dry-run mode: prints a report without writing to DB
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const mongoose = require('mongoose');
const connectDB= require('../config/db');
const Segment    = require('../models/Segment');
const SegmentPage= require('../models/SegmentPage');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace(/^--/, '').split('=');
  acc[key] = val === undefined ? true : val;
  return acc;
}, {});

const CSV_FILE = args.file;
const DRY_RUN  = !!args['dry-run'];

if (!CSV_FILE) {
  console.error('❌  Usage: node loadSegmentsFromCSV.js --file=./path/to/file.csv [--dry-run]');
  process.exit(1);
}

// ─── CSV parser (no external deps) ────────────────────────────────────────────
const parseCSV = async (filePath) => {
  const rows   = [];
  const stream = fs.createReadStream(filePath);
  const rl     = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let headers = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    if (!headers) {
      headers = values;
    } else {
      const row = {};
      headers.forEach((h, i) => { row[h] = values[i] || ''; });
      rows.push(row);
    }
  }
  return rows;
};

// ─── Translatable field builder ────────────────────────────────────────────────
const t = (row, prefix) => ({
  en: row[`${prefix}_en`] || '',
  es: row[`${prefix}_es`] || '',
  de: row[`${prefix}_de`] || '',
  fr: row[`${prefix}_fr`] || '',
  it: row[`${prefix}_it`] || '',
  pt: row[`${prefix}_pt`] || '',
});

// ─── Validate a row ────────────────────────────────────────────────────────────
const validateRow = (row, lineNum) => {
  const errors = [];
  if (!row.segment_code) errors.push('segment_code is required');
  if (!row.hero_headline_en) errors.push('hero_headline_en is required');
  if (row.status && !['draft', 'published'].includes(row.status)) {
    errors.push(`status must be 'draft' or 'published', got '${row.status}'`);
  }
  return errors.map((e) => `Row ${lineNum}: ${e}`);
};

// ─── Main ─────────────────────────────────────────────────────────────────────
const run = async () => {
  // Resolve file path
  const filePath = path.resolve(process.cwd(), CSV_FILE);
  if (!fs.existsSync(filePath)) {
    console.error(`❌  File not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`\n📄  Reading CSV: ${filePath}`);
  if (DRY_RUN) console.log('🔍  DRY RUN — no changes will be written\n');

  const rows = await parseCSV(filePath);
  console.log(`📊  Found ${rows.length} data rows\n`);

  // Validate all rows first
  const allErrors = [];
  rows.forEach((row, i) => {
    const errs = validateRow(row, i + 2); // +2 = header row is row 1
    allErrors.push(...errs);
  });

  if (allErrors.length > 0) {
    console.error('❌  Validation errors found — aborting:\n');
    allErrors.forEach((e) => console.error(`   ${e}`));
    process.exit(1);
  }

  if (!DRY_RUN) {
    await connectDB();
  }

  const results = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (const [i, row] of rows.entries()) {
    const lineNum = i + 2;
    try {
      // Find the Segment by code
      const segment = await (DRY_RUN
        ? Promise.resolve({ _id: `dry_run_${row.segment_code}`, slug: row.segment_code.toLowerCase().replace(/_/g, '-') })
        : Segment.findOne({ code: row.segment_code }).lean()
      );

      if (!segment) {
        console.warn(`   ⚠️  Row ${lineNum}: Segment with code '${row.segment_code}' not found — skipping`);
        results.skipped++;
        continue;
      }

      const pageData = {
        segment:         segment._id,
        slug:            segment.slug || row.segment_code.toLowerCase().replace(/_/g, '-'),
        heroHeadline:    t(row, 'hero_headline'),
        heroSubheadline: t(row, 'hero_subheadline'),
        heroImageUrl:    row.hero_image_url || '',
        heroCta: {
          label: t(row, 'hero_cta_label'),
          url:   row.hero_cta_url || '',
        },
        metaTitle:       t(row, 'meta_title'),
        metaDescription: t(row, 'meta_description'),
        status:          row.status || 'draft',
        isActive:        row.is_active !== 'false',
      };

      if (DRY_RUN) {
        console.log(`   ✓ [DRY] Would upsert SegmentPage for: ${row.segment_code} (slug: ${pageData.slug})`);
        results.created++;
        continue;
      }

      const existing = await SegmentPage.findOne({ segment: segment._id });
      if (existing) {
        await SegmentPage.findByIdAndUpdate(existing._id, { $set: pageData });
        console.log(`   ✏️  Updated: ${row.segment_code}`);
        results.updated++;
      } else {
        await SegmentPage.create(pageData);
        console.log(`   ✅  Created: ${row.segment_code}`);
        results.created++;
      }
    } catch (err) {
      console.error(`   ❌  Row ${lineNum} failed: ${err.message}`);
      results.errors.push(`Row ${lineNum} (${row.segment_code}): ${err.message}`);
    }
  }

  console.log('\n─── Summary ─────────────────────────────────────────────────────');
  console.log(`   Created : ${results.created}`);
  console.log(`   Updated : ${results.updated}`);
  console.log(`   Skipped : ${results.skipped}`);
  console.log(`   Errors  : ${results.errors.length}`);
  if (results.errors.length > 0) {
    console.log('\n   Error details:');
    results.errors.forEach((e) => console.log(`     - ${e}`));
  }
  console.log('─────────────────────────────────────────────────────────────────\n');

  if (!DRY_RUN) {
    await mongoose.connection.close();
  }
  process.exit(results.errors.length > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error('❌  Fatal error:', err);
  process.exit(1);
});
