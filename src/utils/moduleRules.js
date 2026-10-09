/**
 * moduleRules — decides which content modules are shown on a PDP.
 *
 * The source of truth is ProductType.activeModules (set in seed data).
 * This utility provides a single function that applies those rules so
 * the logic lives in ONE place across all callers.
 *
 * Module keys (must match ProductType.activeModules enum):
 *   specifications, operation_motorization, frame_features,
 *   fabric_valance_thread, heat_sealing, accessories,
 *   installation_types, manuals, faq, warranty, financing, comparison
 *
 * Done-check rule (from Prompt 1.8 spec):
 *   - Umbrella page → frame/fabric modules must NOT appear
 *   - Awning page   → frame/fabric modules MUST appear
 */

/**
 * getActiveModules — returns the set of modules to show for a product type.
 *
 * @param {string[]} productTypeModules — ProductType.activeModules array
 * @returns {Set<string>}
 */
const getActiveModules = (productTypeModules = []) => {
  return new Set(productTypeModules);
};

/**
 * buildModuleVisibility — returns a flat object { moduleKey: boolean }
 * for every known module, so the frontend can conditionally render.
 *
 * @param {string[]} productTypeModules
 * @returns {Object}
 */
const ALL_MODULES = [
  'specifications',
  'operation_motorization',
  'frame_features',
  'fabric_valance_thread',
  'heat_sealing',
  'accessories',
  'installation_types',
  'manuals',
  'faq',
  'warranty',
  'financing',
  'comparison',
];

const buildModuleVisibility = (productTypeModules = []) => {
  const active = new Set(productTypeModules);
  const visibility = {};
  for (const mod of ALL_MODULES) {
    visibility[mod] = active.has(mod);
  }
  return visibility;
};

/**
 * assertModuleRule — used in tests to verify a product type
 * shows / hides the correct modules.
 *
 * @param {string[]} modules   — ProductType.activeModules
 * @param {string}   key       — module key to check
 * @param {boolean}  expected  — true = should show, false = should hide
 * @returns {{ pass: boolean, message: string }}
 */
const assertModuleRule = (modules, key, expected) => {
  const visibility = buildModuleVisibility(modules);
  const actual     = visibility[key];
  const pass       = actual === expected;
  return {
    pass,
    message: pass
      ? `✔ ${key} is ${expected ? 'shown' : 'hidden'} as expected`
      : `✖ ${key}: expected ${expected ? 'shown' : 'hidden'}, got ${actual ? 'shown' : 'hidden'}`,
  };
};

module.exports = { getActiveModules, buildModuleVisibility, assertModuleRule, ALL_MODULES };
