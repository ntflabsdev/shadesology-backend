/**
 * Seed script — populates the database with:
 *  - 9 Product Types
 *  - 14 Market Segments
 *  - 1 sample Manufacturer
 *  - 1 sample Category per product type
 *  - Core AttributeDefinitions (shared filters + comparison rows)
 *  - 2 sample Colors
 *  - 1 sample Fabric
 *  - 1 sample OptionGroup (Frame Color)
 *  - 1 sample Product with 1 Variant
 *
 * Usage:
 *   node src/seeds/seed.js            — inserts only (skips existing)
 *   node src/seeds/seed.js --fresh    — drops all seeded collections first
 */

const dotenv = require('dotenv');
const path = require('node:path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const connectDB = require('../config/db');

// ─── Models ──────────────────────────────────────────────────────────────────
const ProductType = require('../models/ProductType');
const Category = require('../models/Category');
const Manufacturer = require('../models/Manufacturer');
const Segment = require('../models/Segment');
const AttributeDefinition = require('../models/AttributeDefinition');
const Color = require('../models/Color');
const Fabric = require('../models/Fabric');
const OptionGroup = require('../models/OptionGroup');
const Product = require('../models/Product');
const Variant = require('../models/Variant');

// ─── Helpers ─────────────────────────────────────────────────────────────────
const t = (en, es = '', de = '', fr = '', it = '', pt = '') => ({ en, es, de, fr, it, pt });

const isFresh = process.argv.includes('--fresh');

// ─── Data ────────────────────────────────────────────────────────────────────

const PRODUCT_TYPES = [
  {
    code: 'RETRACTABLE_AWNING',
    slug: 'retractable-awning',
    name: t('Retractable Awning', 'Toldo Retráctil'),
    description: t('Motorised or manual fabric awnings that retract into a cassette or open arm design.'),
    hasConfigurator: true,
    configuratorKey: 'retractable_awning',
    activeModules: ['specifications', 'operation_motorization', 'frame_features', 'fabric_valance_thread', 'accessories', 'installation_types', 'manuals', 'faq', 'warranty', 'financing'],
    sortOrder: 1,
  },
  {
    code: 'FABRIC_PERGOLA',
    slug: 'fabric-pergola',
    name: t('Retractable Fabric Pergola', 'Pérgola de Tela Retráctil'),
    description: t('Freestanding or attached pergola structures with retractable fabric roofs.'),
    hasConfigurator: true,
    configuratorKey: 'fabric_pergola',
    activeModules: ['specifications', 'operation_motorization', 'frame_features', 'fabric_valance_thread', 'heat_sealing', 'accessories', 'installation_types', 'manuals', 'faq', 'warranty', 'financing'],
    sortOrder: 2,
  },
  {
    code: 'LOUVERED_ROOF',
    slug: 'louvered-roof',
    name: t('Louvered Roof', 'Techo con Lamas'),
    description: t('Aluminium pergola systems with adjustable louvres for light and ventilation control.'),
    hasConfigurator: true,
    configuratorKey: 'louvered_roof',
    activeModules: ['specifications', 'operation_motorization', 'frame_features', 'accessories', 'installation_types', 'manuals', 'faq', 'warranty', 'financing'],
    sortOrder: 3,
  },
  {
    code: 'SHADE_SAIL',
    slug: 'shade-sail',
    name: t('Shade Sail', 'Vela de Sombra'),
    description: t('Geometric tensioned fabric sails for residential and commercial shade.'),
    hasConfigurator: true,
    configuratorKey: 'shade_sail',
    activeModules: ['specifications', 'frame_features', 'fabric_valance_thread', 'heat_sealing', 'accessories', 'installation_types', 'manuals', 'faq', 'warranty'],
    sortOrder: 4,
  },
  {
    code: 'RETRACTABLE_SCREEN',
    slug: 'retractable-screen',
    name: t('Retractable Screen', 'Pantalla Retráctil'),
    description: t('Motorised or manual screens for privacy, insect protection, and solar control.'),
    hasConfigurator: true,
    configuratorKey: 'retractable_screen',
    activeModules: ['specifications', 'operation_motorization', 'frame_features', 'fabric_valance_thread', 'accessories', 'installation_types', 'manuals', 'faq', 'warranty'],
    sortOrder: 5,
  },
  {
    code: 'HORIZONTAL_BLIND',
    slug: 'horizontal-blind',
    name: t('Retractable Horizontal Blind', 'Persiana Horizontal Retráctil'),
    description: t('External horizontal blinds providing solar control and privacy.'),
    hasConfigurator: true,
    configuratorKey: 'horizontal_blind',
    activeModules: ['specifications', 'operation_motorization', 'frame_features', 'fabric_valance_thread', 'accessories', 'installation_types', 'manuals', 'faq', 'warranty'],
    sortOrder: 6,
  },
  {
    code: 'UMBRELLA',
    slug: 'umbrella',
    name: t('Retractable Umbrella', 'Sombrilla Retráctil'),
    description: t('Commercial and residential cantilever and centre-pole shade umbrellas.'),
    hasConfigurator: true,
    configuratorKey: 'umbrella',
    activeModules: ['specifications', 'frame_features', 'fabric_valance_thread', 'accessories', 'manuals', 'faq', 'warranty'],
    sortOrder: 7,
  },
  {
    code: 'POOL_COVER',
    slug: 'pool-cover',
    name: t('Pool Cover', 'Cubierta de Piscina'),
    description: t('Safety and thermal pool covers including automatic and manual systems.'),
    hasConfigurator: true,
    configuratorKey: 'pool_cover',
    activeModules: ['specifications', 'operation_motorization', 'frame_features', 'accessories', 'installation_types', 'manuals', 'faq', 'warranty'],
    sortOrder: 8,
  },
  {
    code: 'TENSILE_STRUCTURE',
    slug: 'tensile-structure',
    name: t('Tensile Structure', 'Estructura Tensada'),
    description: t('Fixed architectural fabric structures for large-scale commercial shade.'),
    hasConfigurator: false,
    configuratorKey: null,
    activeModules: ['specifications', 'frame_features', 'fabric_valance_thread', 'heat_sealing', 'accessories', 'manuals', 'faq', 'warranty'],
    sortOrder: 9,
  },
];

const SEGMENTS = [
  { code: 'RESIDENTIAL_HOME',          slug: 'residential-home',           name: t('Home'),                       audience: 'residential', sortOrder: 1  },
  { code: 'RESIDENTIAL_OUTDOOR',       slug: 'residential-outdoor-living',  name: t('Outdoor Living'),             audience: 'residential', sortOrder: 2  },
  { code: 'RESIDENTIAL_POOLSIDE',      slug: 'residential-poolside',        name: t('Poolside'),                   audience: 'residential', sortOrder: 3  },
  { code: 'RESIDENTIAL_BALCONY',       slug: 'residential-balcony-terrace', name: t('Balcony & Terrace'),          audience: 'residential', sortOrder: 4  },
  { code: 'COMMERCIAL_HOSPITALITY',    slug: 'commercial-hospitality',      name: t('Hospitality'),                audience: 'commercial',  sortOrder: 5  },
  { code: 'COMMERCIAL_RESTAURANT',     slug: 'commercial-restaurant-cafe',  name: t('Restaurant & Café'),          audience: 'commercial',  sortOrder: 6  },
  { code: 'COMMERCIAL_RETAIL',         slug: 'commercial-retail',           name: t('Retail'),                     audience: 'commercial',  sortOrder: 7  },
  { code: 'COMMERCIAL_OFFICE',         slug: 'commercial-office',           name: t('Office'),                     audience: 'commercial',  sortOrder: 8  },
  { code: 'COMMERCIAL_HEALTHCARE',     slug: 'commercial-healthcare',       name: t('Healthcare'),                 audience: 'commercial',  sortOrder: 9  },
  { code: 'COMMERCIAL_EDUCATION',      slug: 'commercial-education',        name: t('Education'),                  audience: 'commercial',  sortOrder: 10 },
  { code: 'COMMERCIAL_GOVERNMENT',     slug: 'commercial-government',       name: t('Government'),                 audience: 'commercial',  sortOrder: 11 },
  { code: 'COMMERCIAL_SPORTS',         slug: 'commercial-sports-recreation',name: t('Sports & Recreation'),        audience: 'commercial',  sortOrder: 12 },
  { code: 'COMMERCIAL_INDUSTRIAL',     slug: 'commercial-industrial',       name: t('Industrial'),                 audience: 'commercial',  sortOrder: 13 },
  { code: 'COMMERCIAL_PROPERTY_MGMT',  slug: 'commercial-property-management', name: t('Property Management'),    audience: 'commercial',  sortOrder: 14 },
];

const ATTRIBUTE_DEFINITIONS = [
  { key: 'mount_type',      name: t('Mount Type'),       type: 'select',  useAsFilter: true,  filterDisplayType: 'checkbox',     useInComparison: true, showOnPdp: true,  group: t('Installation'), sortOrder: 1,
    options: [
      { value: 'wall',    label: t('Wall Mount') },
      { value: 'ceiling', label: t('Ceiling Mount') },
      { value: 'soffit',  label: t('Soffit Mount') },
      { value: 'post',    label: t('Post Mount') },
      { value: 'ground',  label: t('Ground Mount') },
    ],
  },
  { key: 'operation',       name: t('Operation'),        type: 'select',  useAsFilter: true,  filterDisplayType: 'button_group', useInComparison: true, showOnPdp: true,  group: t('Operation'), sortOrder: 2,
    options: [
      { value: 'manual',    label: t('Manual') },
      { value: 'motorized', label: t('Motorized') },
      { value: 'smart',     label: t('Smart / App-Controlled') },
    ],
  },
  { key: 'wind_rating',     name: t('Wind Rating'),      type: 'number', unit: 'mph', unitMetric: 'km/h', useAsFilter: false, useInComparison: true, showOnPdp: true, group: t('Performance'), sortOrder: 3 },
  { key: 'width_range',     name: t('Width Range'),      type: 'range',  unit: 'ft',  unitMetric: 'm',   useAsFilter: true,  filterDisplayType: 'range_slider', useInComparison: true, showOnPdp: true, group: t('Dimensions'), sortOrder: 4 },
  { key: 'projection_range',name: t('Projection Range'), type: 'range',  unit: 'ft',  unitMetric: 'm',   useAsFilter: true,  filterDisplayType: 'range_slider', useInComparison: true, showOnPdp: true, group: t('Dimensions'), sortOrder: 5 },
  { key: 'frame_material',  name: t('Frame Material'),   type: 'select', useAsFilter: true, filterDisplayType: 'checkbox', useInComparison: true, showOnPdp: true, group: t('Frame'), sortOrder: 6,
    options: [
      { value: 'aluminium', label: t('Aluminium') },
      { value: 'steel',     label: t('Steel') },
      { value: 'stainless', label: t('Stainless Steel') },
    ],
  },
  { key: 'warranty_years',  name: t('Warranty'),         type: 'number', unit: 'years', useAsFilter: false, useInComparison: true, showOnPdp: true, group: t('Warranty'), sortOrder: 7 },
  { key: 'lead_time_days',  name: t('Lead Time'),        type: 'number', unit: 'days',  useAsFilter: false, useInComparison: true, showOnPdp: true, group: t('Availability'), sortOrder: 8 },
  { key: 'color_options',   name: t('Color Options'),    type: 'multi_select', useAsFilter: true, filterDisplayType: 'color_swatch', useInComparison: false, showOnPdp: true, group: t('Frame'), sortOrder: 9 },
];

// ─── Main seed function ───────────────────────────────────────────────────────
const seed = async () => {
  await connectDB();

  if (isFresh) {
    console.log('🗑  Dropping seeded collections...');
    await Promise.all([
      ProductType.deleteMany({}),
      Category.deleteMany({}),
      Manufacturer.deleteMany({}),
      Segment.deleteMany({}),
      AttributeDefinition.deleteMany({}),
      Color.deleteMany({}),
      Fabric.deleteMany({}),
      OptionGroup.deleteMany({}),
      Product.deleteMany({}),
      Variant.deleteMany({}),
    ]);
    console.log('✅ Collections cleared.');
  }

  // ── 1. Product Types ────────────────────────────────────────────────────────
  console.log('\n📦 Seeding product types...');
  const productTypeMap = {};
  for (const pt of PRODUCT_TYPES) {
    const doc = await ProductType.findOneAndUpdate(
      { code: pt.code },
      { $setOnInsert: pt },
      { upsert: true, new: true }
    );
    productTypeMap[pt.code] = doc._id;
    console.log(`   ✓ ${pt.name.en}`);
  }

  // ── 2. Segments ─────────────────────────────────────────────────────────────
  console.log('\n🏷  Seeding segments...');
  for (const seg of SEGMENTS) {
    await Segment.findOneAndUpdate(
      { code: seg.code },
      { $setOnInsert: seg },
      { upsert: true, new: true }
    );
    console.log(`   ✓ ${seg.name.en}`);
  }

  // ── 3. Manufacturer ─────────────────────────────────────────────────────────
  console.log('\n🏭  Seeding manufacturer...');
  const manufacturer = await Manufacturer.findOneAndUpdate(
    { slug: 'weinor' },
    {
      $setOnInsert: {
        name: 'Weinor',
        slug: 'weinor',
        description: t('German manufacturer of high-quality awnings and pergola systems since 1955.'),
        website: 'https://www.weinor.de',
        country: 'DE',
        isActive: true,
      },
    },
    { upsert: true, new: true }
  );
  console.log(`   ✓ ${manufacturer.name}`);

  // ── 4. Categories ───────────────────────────────────────────────────────────
  console.log('\n📁  Seeding categories...');
  const categoryMap = {};
  for (const pt of PRODUCT_TYPES) {
    const cat = await Category.findOneAndUpdate(
      { slug: pt.slug },
      {
        $setOnInsert: {
          name: pt.name,
          slug: pt.slug,
          description: pt.description,
          productTypes: [productTypeMap[pt.code]],
          isActive: true,
          sortOrder: pt.sortOrder,
        },
      },
      { upsert: true, new: true }
    );
    categoryMap[pt.code] = cat._id;
    console.log(`   ✓ ${pt.name.en}`);
  }

  // ── 5. Attribute Definitions ─────────────────────────────────────────────────
  console.log('\n🔖  Seeding attribute definitions...');
  for (const attr of ATTRIBUTE_DEFINITIONS) {
    await AttributeDefinition.findOneAndUpdate(
      { key: attr.key },
      { $setOnInsert: attr },
      { upsert: true, new: true }
    );
    console.log(`   ✓ ${attr.name.en}`);
  }

  // ── 6. Colors ───────────────────────────────────────────────────────────────
  console.log('\n🎨  Seeding colors...');
  const colorWhite = await Color.findOneAndUpdate(
    { slug: 'ral-9016-traffic-white' },
    {
      $setOnInsert: {
        name: t('Traffic White', 'Blanco Tráfico'),
        slug: 'ral-9016-traffic-white',
        system: 'ral',
        code: 'RAL 9016',
        hexValue: '#F1F0EA',
        finish: 'matte',
        isActive: true,
      },
    },
    { upsert: true, new: true }
  );

  const colorAnthracite = await Color.findOneAndUpdate(
    { slug: 'ral-7016-anthracite-grey' },
    {
      $setOnInsert: {
        name: t('Anthracite Grey', 'Gris Antracita'),
        slug: 'ral-7016-anthracite-grey',
        system: 'ral',
        code: 'RAL 7016',
        hexValue: '#383E42',
        finish: 'matte',
        isActive: true,
      },
    },
    { upsert: true, new: true }
  );
  console.log('   ✓ RAL 9016 Traffic White');
  console.log('   ✓ RAL 7016 Anthracite Grey');

  // ── 7. Fabric ────────────────────────────────────────────────────────────────
  console.log('\n🧵  Seeding fabric...');
  const fabric = await Fabric.findOneAndUpdate(
    { slug: 'dickson-orchestra-11001' },
    {
      $setOnInsert: {
        name: t('Orchestra 11001 Chalk White'),
        slug: 'dickson-orchestra-11001',
        sku: 'DK-ORCH-11001',
        brand: 'Dickson',
        subRange: 'Orchestra',
        description: t('Premium acrylic fabric with excellent UV resistance and weather durability.'),
        composition: '100% Solution-dyed acrylic',
        opennessFactor: 0,
        weightGsm: 320,
        warrantyYears: 5,
        color: 'White',
        pattern: 'solid',
        opacity: 'opaque',
        compatibleProductTypes: [productTypeMap['RETRACTABLE_AWNING'], productTypeMap['FABRIC_PERGOLA']],
        isActive: true,
        sampleAvailable: true,
      },
    },
    { upsert: true, new: true }
  );
  console.log(`   ✓ ${fabric.name.en}`);

  // ── 8. Option Group ──────────────────────────────────────────────────────────
  console.log('\n⚙️   Seeding option group...');
  const optionGroup = await OptionGroup.findOneAndUpdate(
    { slug: 'frame-color' },
    {
      $setOnInsert: {
        name: t('Frame Color', 'Color del Marco'),
        slug: 'frame-color',
        displayType: 'color_swatch',
        isRequired: true,
        allowMultiple: false,
        options: [
          {
            name: t('Traffic White', 'Blanco Tráfico'),
            value: 'ral-9016',
            surchargeType: 'none',
            surchargeAmount: 0,
            color: colorWhite._id,
            isAvailable: true,
            sortOrder: 1,
          },
          {
            name: t('Anthracite Grey', 'Gris Antracita'),
            value: 'ral-7016',
            surchargeType: 'fixed',
            surchargeAmount: 150,
            color: colorAnthracite._id,
            isAvailable: true,
            sortOrder: 2,
          },
        ],
        productTypes: [productTypeMap['RETRACTABLE_AWNING']],
        isActive: true,
        sortOrder: 1,
      },
    },
    { upsert: true, new: true }
  );
  console.log(`   ✓ ${optionGroup.name.en}`);

  // ── 9. Sample Product + Variant ──────────────────────────────────────────────
  console.log('\n🛍  Seeding sample product...');
  const product = await Product.findOneAndUpdate(
    { slug: 'weinor-cassita-ii' },
    {
      $setOnInsert: {
        name: t('Weinor Cassita II', 'Weinor Cassita II'),
        slug: 'weinor-cassita-ii',
        category: categoryMap['RETRACTABLE_AWNING'],
        productType: productTypeMap['RETRACTABLE_AWNING'],
        manufacturer: manufacturer._id,
        shortDescription: t('The cassette awning with full fabric protection and elegant design.'),
        description: t(
          'The Cassita II is Weinor\'s flagship cassette awning. The robust cassette housing ' +
          'fully protects the fabric and arms when retracted, ensuring long-lasting performance ' +
          'even in challenging climates.'
        ),
        features: [
          { text: t('Full cassette fabric protection') },
          { text: t('Available in motorized and manual operation') },
          { text: t('Width up to 49 ft / 15 m') },
          { text: t('5-year frame warranty, 3-year fabric warranty') },
        ],
        attributes: new Map([
          ['mount_type', 'wall'],
          ['operation', 'motorized'],
          ['wind_rating', 45],
          ['frame_material', 'aluminium'],
          ['warranty_years', 5],
        ]),
        fabrics: [fabric._id],
        colors: [colorWhite._id, colorAnthracite._id],
        showPrice: true,
        isFeatured: true,
        isActive: true,
        sortOrder: 1,
      },
    },
    { upsert: true, new: true }
  );
  console.log(`   ✓ ${product.name.en}`);

  // Variant
  const variant = await Variant.findOneAndUpdate(
    { sku: 'WN-CAS2-300-250-MOT' },
    {
      $setOnInsert: {
        product: product._id,
        name: t('Cassita II 10ft × 8ft Motorized'),
        sku: 'WN-CAS2-300-250-MOT',
        basePrice: 2499,
        priceTiers: [
          { tierKey: 'dealer', price: 1749 },
          { tierKey: 'wholesale', price: 1499 },
        ],
        widthMin: 84,   // 7 ft in inches
        widthMax: 120,  // 10 ft in inches
        projectionMin: 60,
        projectionMax: 96,
        freightClass: 150,
        shippingWeightLbs: 85,
        requiresCrating: false,
        leadTimeDays: 14,
        leadTimeNote: t('Made to order — 14 business days production'),
        availability: 'made_to_order',
        allowedOptionGroups: [optionGroup._id],
        isDefault: true,
        isActive: true,
        sortOrder: 1,
      },
    },
    { upsert: true, new: true }
  );
  console.log(`   ✓ Variant: ${variant.name.en} (${variant.sku})`);

  console.log('\n✅ Seed complete!\n');
  await mongoose.connection.close();
  process.exit(0);
};

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
