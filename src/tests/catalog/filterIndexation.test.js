/**
 * Filter canonical/noindex rules — Prompt 1.7 done-check.
 *
 * Tests that getIndexationRule() returns the correct
 * indexation decision for every filter combination scenario.
 *
 * Node built-in test runner — no DB needed.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { getIndexationRule } = require('../../utils/filterBuilder');

const BASE = '/category/retractable-awning';
const CRAWLABLE_KEYS = ['mount_type', 'operation'];

describe('getIndexationRule — no filters active', () => {
  test('returns index:true and base canonical', () => {
    const result = getIndexationRule(CRAWLABLE_KEYS, {}, BASE);
    assert.equal(result.index, true);
    assert.equal(result.canonical, BASE);
  });

  test('empty crawlableFilterKeys still returns index:true', () => {
    const result = getIndexationRule([], {}, BASE);
    assert.equal(result.index, true);
    assert.equal(result.canonical, BASE);
  });
});

describe('getIndexationRule — single filter active', () => {
  test('single crawlable filter → index:true, no canonical override', () => {
    const result = getIndexationRule(CRAWLABLE_KEYS, { mount_type: 'wall' }, BASE);
    assert.equal(result.index, true);
    assert.equal(result.canonical, null);
  });

  test('second crawlable filter alone → index:true', () => {
    const result = getIndexationRule(CRAWLABLE_KEYS, { operation: 'motorized' }, BASE);
    assert.equal(result.index, true);
    assert.equal(result.canonical, null);
  });

  test('single NON-crawlable filter → noindex, canonical = base', () => {
    const result = getIndexationRule(CRAWLABLE_KEYS, { warranty_years: '5' }, BASE);
    assert.equal(result.index, false);
    assert.equal(result.canonical, BASE);
  });
});

describe('getIndexationRule — multiple filters active', () => {
  test('two crawlable filters combined → noindex, canonical = base', () => {
    const result = getIndexationRule(
      CRAWLABLE_KEYS,
      { mount_type: 'wall', operation: 'motorized' },
      BASE
    );
    assert.equal(result.index, false);
    assert.equal(result.canonical, BASE);
  });

  test('one crawlable + one non-crawlable → noindex, canonical = base', () => {
    const result = getIndexationRule(
      CRAWLABLE_KEYS,
      { mount_type: 'wall', warranty_years: '5' },
      BASE
    );
    assert.equal(result.index, false);
    assert.equal(result.canonical, BASE);
  });

  test('two non-crawlable filters → noindex, canonical = base', () => {
    const result = getIndexationRule(
      CRAWLABLE_KEYS,
      { warranty_years: '5', frame_material: 'aluminium' },
      BASE
    );
    assert.equal(result.index, false);
    assert.equal(result.canonical, BASE);
  });

  test('three or more filters → noindex regardless of keys', () => {
    const result = getIndexationRule(
      CRAWLABLE_KEYS,
      { mount_type: 'wall', operation: 'motorized', frame_material: 'aluminium' },
      BASE
    );
    assert.equal(result.index, false);
    assert.equal(result.canonical, BASE);
  });
});

describe('getIndexationRule — empty / edge cases', () => {
  test('undefined active filters → index:true', () => {
    const result = getIndexationRule(CRAWLABLE_KEYS, undefined, BASE);
    assert.equal(result.index, true);
  });

  test('filter with empty string value is treated as inactive', () => {
    const result = getIndexationRule(CRAWLABLE_KEYS, { mount_type: '' }, BASE);
    assert.equal(result.index, true);
    assert.equal(result.canonical, BASE);
  });

  test('canonical is always the base URL when noindex', () => {
    const customBase = '/category/shade-sail';
    const result = getIndexationRule(['mount_type'], { mount_type: 'wall', operation: 'motorized' }, customBase);
    assert.equal(result.canonical, customBase);
  });
});

describe('buildProductFilter — from filterBuilder', () => {
  const { buildProductFilter } = require('../../utils/filterBuilder');

  const ATTR_DEFS = [
    { key: 'mount_type',    type: 'select' },
    { key: 'operation',     type: 'multi_select' },
    { key: 'width_range',   type: 'range', unit: 'ft' },
    { key: 'is_motorized',  type: 'boolean' },
    { key: 'wind_rating',   type: 'number' },
  ];

  test('select filter → exact match', () => {
    const filter = buildProductFilter({ mount_type: 'wall' }, ATTR_DEFS);
    assert.deepEqual(filter['attributes.mount_type'], 'wall');
  });

  test('multi_select filter → $in array', () => {
    const filter = buildProductFilter({ operation: 'motorized,manual' }, ATTR_DEFS);
    assert.deepEqual(filter['attributes.operation'], { $in: ['motorized', 'manual'] });
  });

  test('range filter → $gte/$lte', () => {
    const filter = buildProductFilter({ width_range: '7,15' }, ATTR_DEFS);
    assert.deepEqual(filter['attributes.width_range'], { $gte: 7, $lte: 15 });
  });

  test('boolean filter true', () => {
    const filter = buildProductFilter({ is_motorized: 'true' }, ATTR_DEFS);
    assert.equal(filter['attributes.is_motorized'], true);
  });

  test('boolean filter false', () => {
    const filter = buildProductFilter({ is_motorized: 'false' }, ATTR_DEFS);
    assert.equal(filter['attributes.is_motorized'], false);
  });

  test('number filter → cast to number', () => {
    const filter = buildProductFilter({ wind_rating: '45' }, ATTR_DEFS);
    assert.equal(filter['attributes.wind_rating'], 45);
  });

  test('unknown query param is ignored', () => {
    const filter = buildProductFilter({ totally_unknown: 'xyz' }, ATTR_DEFS);
    assert.equal(filter['attributes.totally_unknown'], undefined);
  });

  test('empty string value is ignored', () => {
    const filter = buildProductFilter({ mount_type: '' }, ATTR_DEFS);
    assert.equal(filter['attributes.mount_type'], undefined);
  });

  test('multiple filters combined', () => {
    const filter = buildProductFilter(
      { mount_type: 'wall', operation: 'motorized', wind_rating: '45' },
      ATTR_DEFS
    );
    assert.equal(filter['attributes.mount_type'], 'wall');
    assert.deepEqual(filter['attributes.operation'], { $in: ['motorized'] });
    assert.equal(filter['attributes.wind_rating'], 45);
  });
});
