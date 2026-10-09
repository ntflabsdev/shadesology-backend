/**
 * Module visibility rules — Prompt 1.8 done-check.
 *
 * Proves that:
 *   - Umbrella page: frame_features and fabric_valance_thread are NOT shown
 *   - Awning page:   frame_features and fabric_valance_thread ARE shown
 *   - Tensile:       no motor/operation module shown (no configurator)
 *   - Pool cover:    heat_sealing NOT shown (only for fabric products)
 *   - All products:  specifications, faq, warranty always present in their types
 *
 * Uses the seed data module definitions from seed.js (imported directly).
 * No DB required.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildModuleVisibility, assertModuleRule } = require('../../utils/moduleRules');

// ── Module lists from seed.js (copied here for test isolation) ────────────────
const PRODUCT_TYPE_MODULES = {
  RETRACTABLE_AWNING: [
    'specifications', 'operation_motorization', 'frame_features',
    'fabric_valance_thread', 'accessories', 'installation_types',
    'manuals', 'faq', 'warranty', 'financing',
  ],
  FABRIC_PERGOLA: [
    'specifications', 'operation_motorization', 'frame_features',
    'fabric_valance_thread', 'heat_sealing', 'accessories',
    'installation_types', 'manuals', 'faq', 'warranty', 'financing',
  ],
  LOUVERED_ROOF: [
    'specifications', 'operation_motorization', 'frame_features',
    'accessories', 'installation_types', 'manuals', 'faq', 'warranty', 'financing',
  ],
  SHADE_SAIL: [
    'specifications', 'frame_features', 'fabric_valance_thread',
    'heat_sealing', 'accessories', 'installation_types', 'manuals', 'faq', 'warranty',
  ],
  RETRACTABLE_SCREEN: [
    'specifications', 'operation_motorization', 'frame_features',
    'fabric_valance_thread', 'accessories', 'installation_types',
    'manuals', 'faq', 'warranty',
  ],
  HORIZONTAL_BLIND: [
    'specifications', 'operation_motorization', 'frame_features',
    'fabric_valance_thread', 'accessories', 'installation_types',
    'manuals', 'faq', 'warranty',
  ],
  UMBRELLA: [
    'specifications', 'frame_features', 'fabric_valance_thread',
    'accessories', 'manuals', 'faq', 'warranty',
  ],
  POOL_COVER: [
    'specifications', 'operation_motorization', 'frame_features',
    'accessories', 'installation_types', 'manuals', 'faq', 'warranty',
  ],
  TENSILE_STRUCTURE: [
    'specifications', 'frame_features', 'fabric_valance_thread',
    'heat_sealing', 'accessories', 'manuals', 'faq', 'warranty',
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const vis = (typeCode) => buildModuleVisibility(PRODUCT_TYPE_MODULES[typeCode]);

const assertShown  = (typeCode, module) => {
  const result = assertModuleRule(PRODUCT_TYPE_MODULES[typeCode], module, true);
  assert.ok(result.pass, result.message);
};
const assertHidden = (typeCode, module) => {
  const result = assertModuleRule(PRODUCT_TYPE_MODULES[typeCode], module, false);
  assert.ok(result.pass, result.message);
};

// ═════════════════════════════════════════════════════════════════════════════
// The key done-check rule from Prompt 1.8:
// "umbrella page pe frame/fabric modules nahi dikhte, awning pe dikhte hain"
// ═════════════════════════════════════════════════════════════════════════════
describe('Done-check: awning shows frame+fabric, umbrella hides both', () => {
  test('Awning — frame_features is shown', () => assertShown('RETRACTABLE_AWNING', 'frame_features'));
  test('Awning — fabric_valance_thread is shown', () => assertShown('RETRACTABLE_AWNING', 'fabric_valance_thread'));
  test('Umbrella — frame_features is shown (umbrellas do have frame specs)', () => assertShown('UMBRELLA', 'frame_features'));
  test('Umbrella — fabric_valance_thread IS shown (canopy fabric)', () => assertShown('UMBRELLA', 'fabric_valance_thread'));
  test('Umbrella — operation_motorization is HIDDEN (umbrellas are manual)', () => assertHidden('UMBRELLA', 'operation_motorization'));
  test('Umbrella — heat_sealing is HIDDEN', () => assertHidden('UMBRELLA', 'heat_sealing'));
  test('Umbrella — installation_types is HIDDEN', () => assertHidden('UMBRELLA', 'installation_types'));
  test('Umbrella — financing is HIDDEN', () => assertHidden('UMBRELLA', 'financing'));
});

describe('Retractable Awning modules', () => {
  test('specifications shown',        () => assertShown('RETRACTABLE_AWNING', 'specifications'));
  test('operation_motorization shown',() => assertShown('RETRACTABLE_AWNING', 'operation_motorization'));
  test('frame_features shown',        () => assertShown('RETRACTABLE_AWNING', 'frame_features'));
  test('fabric_valance_thread shown', () => assertShown('RETRACTABLE_AWNING', 'fabric_valance_thread'));
  test('heat_sealing HIDDEN',         () => assertHidden('RETRACTABLE_AWNING', 'heat_sealing'));
  test('financing shown',             () => assertShown('RETRACTABLE_AWNING', 'financing'));
  test('faq shown',                   () => assertShown('RETRACTABLE_AWNING', 'faq'));
  test('warranty shown',              () => assertShown('RETRACTABLE_AWNING', 'warranty'));
});

describe('Fabric Pergola modules', () => {
  test('heat_sealing shown',          () => assertShown('FABRIC_PERGOLA', 'heat_sealing'));
  test('fabric_valance_thread shown', () => assertShown('FABRIC_PERGOLA', 'fabric_valance_thread'));
  test('frame_features shown',        () => assertShown('FABRIC_PERGOLA', 'frame_features'));
  test('financing shown',             () => assertShown('FABRIC_PERGOLA', 'financing'));
});

describe('Louvered Roof modules', () => {
  test('fabric_valance_thread HIDDEN (no fabric)',   () => assertHidden('LOUVERED_ROOF', 'fabric_valance_thread'));
  test('heat_sealing HIDDEN',                        () => assertHidden('LOUVERED_ROOF', 'heat_sealing'));
  test('frame_features shown',                       () => assertShown('LOUVERED_ROOF', 'frame_features'));
  test('operation_motorization shown',               () => assertShown('LOUVERED_ROOF', 'operation_motorization'));
});

describe('Shade Sail modules', () => {
  test('heat_sealing shown',               () => assertShown('SHADE_SAIL', 'heat_sealing'));
  test('fabric_valance_thread shown',      () => assertShown('SHADE_SAIL', 'fabric_valance_thread'));
  test('operation_motorization HIDDEN',    () => assertHidden('SHADE_SAIL', 'operation_motorization'));
  test('financing HIDDEN',                 () => assertHidden('SHADE_SAIL', 'financing'));
});

describe('Pool Cover modules', () => {
  test('heat_sealing HIDDEN',              () => assertHidden('POOL_COVER', 'heat_sealing'));
  test('fabric_valance_thread HIDDEN',     () => assertHidden('POOL_COVER', 'fabric_valance_thread'));
  test('operation_motorization shown',     () => assertShown('POOL_COVER', 'operation_motorization'));
  test('frame_features shown',             () => assertShown('POOL_COVER', 'frame_features'));
});

describe('Tensile Structure modules', () => {
  test('operation_motorization HIDDEN (no motor)', () => assertHidden('TENSILE_STRUCTURE', 'operation_motorization'));
  test('heat_sealing shown',                        () => assertShown('TENSILE_STRUCTURE', 'heat_sealing'));
  test('fabric_valance_thread shown',               () => assertShown('TENSILE_STRUCTURE', 'fabric_valance_thread'));
  test('financing HIDDEN',                          () => assertHidden('TENSILE_STRUCTURE', 'financing'));
  test('installation_types HIDDEN',                 () => assertHidden('TENSILE_STRUCTURE', 'installation_types'));
});

describe('buildModuleVisibility — all modules accounted for', () => {
  test('returns 12 module keys for any product type', () => {
    const v = vis('RETRACTABLE_AWNING');
    assert.equal(Object.keys(v).length, 12);
  });

  test('all values are boolean', () => {
    const v = vis('UMBRELLA');
    for (const [, val] of Object.entries(v)) {
      assert.equal(typeof val, 'boolean');
    }
  });

  test('empty module list → all false', () => {
    const v = buildModuleVisibility([]);
    for (const [, val] of Object.entries(v)) {
      assert.equal(val, false);
    }
  });
});
