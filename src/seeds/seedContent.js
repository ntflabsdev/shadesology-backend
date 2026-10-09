/**
 * Content seed — populates HomepageSection and SegmentPage documents.
 *
 * Run AFTER seed.js (requires Segment documents to exist).
 *
 * Usage:
 *   node src/seeds/seedContent.js
 *   node src/seeds/seedContent.js --fresh   (drops homepage + segment pages first)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const mongoose       = require('mongoose');
const connectDB      = require('../config/db');
const HomepageSection= require('../models/HomepageSection');
const SegmentPage    = require('../models/SegmentPage');
const Segment        = require('../models/Segment');

const isFresh = process.argv.includes('--fresh');
const t = (en, es = '') => ({ en, es, de: '', fr: '', it: '', pt: '' });

// ─── Homepage sections ────────────────────────────────────────────────────────
const HOMEPAGE_SECTIONS = [
  {
    type: 'hero',
    adminLabel: 'Main Hero',
    headline:    t('Custom Shade Solutions, Built for You', 'Soluciones de Sombra a Medida'),
    subheadline: t('Retractable awnings, pergolas, louvered roofs and more — made to order for residential and commercial spaces.'),
    cta1: { label: t('Shop Products'), url: '/products', style: 'primary' },
    cta2: { label: t('Request a Quote'), url: '/quote', style: 'secondary' },
    backgroundImage: {
      url:       'https://cdn.shadesology.com/hero/main-hero.jpg',
      alt:       t('Custom retractable awning over outdoor living area'),
      mobileUrl: 'https://cdn.shadesology.com/hero/main-hero-mobile.jpg',
    },
    sortOrder: 1,
    isActive:  true,
  },
  {
    type:          'product_overview',
    adminLabel:    'Product Type Overview',
    sectionTitle:  t('Our Products', 'Nuestros Productos'),
    sectionSubtitle: t('Nine categories of premium custom-made shade products.'),
    itemLimit:     9,
    sortOrder:     2,
    isActive:      true,
  },
  {
    type:          'segments_grid',
    adminLabel:    '14 Market Segments Grid',
    sectionTitle:  t('Shade for Every Setting', 'Sombra para Cada Entorno'),
    sectionSubtitle: t('From residential homes to large commercial projects, we cover every application.'),
    sortOrder:     3,
    isActive:      true,
  },
  {
    type:          'featured_products',
    adminLabel:    'Featured Products',
    sectionTitle:  t('Popular Products', 'Productos Populares'),
    sectionSubtitle: t('Handpicked favourites from our range.'),
    featuredProducts: [], // populated by staff in admin
    itemLimit:     6,
    sortOrder:     4,
    isActive:      true,
  },
  {
    type:          'featured_projects',
    adminLabel:    'Featured Projects',
    sectionTitle:  t('Recent Projects', 'Proyectos Recientes'),
    sectionSubtitle: t('Real installations by our certified installer network.'),
    itemLimit:     3,
    sortOrder:     5,
    isActive:      true,
  },
  {
    type:       'trust_band',
    adminLabel: 'Trust & Certifications Band',
    trustItems: [
      { icon: 'shield-check', label: t('Certified Products'),  value: t('Industry certified'),       sortOrder: 1 },
      { icon: 'star',         label: t('Warranty'),            value: t('Up to 10 years'),            sortOrder: 2 },
      { icon: 'users',        label: t('Happy Customers'),     value: t('10,000+ installations'),     sortOrder: 3 },
      { icon: 'tool',         label: t('Installer Network'),   value: t('500+ certified installers'), sortOrder: 4 },
      { icon: 'truck',        label: t('Ships Nationwide'),    value: t('Free shipping over $2,000'), sortOrder: 5 },
    ],
    sortOrder: 6,
    isActive:  true,
  },
  {
    type:          'installer_locator',
    adminLabel:    'Find an Installer',
    sectionTitle:  t('Find a Local Installer', 'Encuentra un Instalador Local'),
    sectionSubtitle: t('Enter your postcode to find a certified installer in your area.'),
    cta1: { label: t('Find Installer'), url: '/find-installer', style: 'primary' },
    cta2: { label: t('Contact Us Instead'), url: '/contact', style: 'outline' },
    sortOrder: 7,
    isActive:  true,
  },
];

// ─── Segment pages ─────────────────────────────────────────────────────────────
// Keyed by segment code — matches Segment.code from seed.js
const SEGMENT_PAGE_DATA = {
  RESIDENTIAL_HOME: {
    heroHeadline:    t('Premium Shade Solutions for Your Home', 'Soluciones de Sombra para tu Hogar'),
    heroSubheadline: t('Retractable awnings, pergolas and screens custom-made for residential properties.'),
    heroImageUrl:    'https://cdn.shadesology.com/segments/residential-home-hero.jpg',
    heroCta:         { label: t('Shop Home Shade'), url: '/retractable-awning' },
    metaTitle:       t('Home Shade Solutions | Shadesology'),
    metaDescription: t('Premium retractable awnings and pergolas for your home. Custom made to order with free shipping.'),
  },
  RESIDENTIAL_OUTDOOR: {
    heroHeadline:    t('Outdoor Living, Reimagined'),
    heroSubheadline: t('Transform your alfresco area with a motorised pergola or retractable awning.'),
    heroImageUrl:    'https://cdn.shadesology.com/segments/outdoor-living-hero.jpg',
    heroCta:         { label: t('Explore Pergolas'), url: '/fabric-pergola' },
    metaTitle:       t('Outdoor Living Shade | Shadesology'),
    metaDescription: t('Create the perfect outdoor living space with motorised pergolas and awnings.'),
  },
  RESIDENTIAL_POOLSIDE: {
    heroHeadline:    t('Cool, Stylish Poolside Shade'),
    heroSubheadline: t('Keep swimmers comfortable and protected with shade sails and pool covers.'),
    heroImageUrl:    'https://cdn.shadesology.com/segments/poolside-hero.jpg',
    heroCta:         { label: t('View Pool Shades'), url: '/shade-sail' },
    metaTitle:       t('Poolside Shade Solutions | Shadesology'),
    metaDescription: t('Premium shade sails and pool covers designed for poolside environments.'),
  },
  RESIDENTIAL_BALCONY: {
    heroHeadline:    t('Make the Most of Your Balcony'),
    heroSubheadline: t('Compact, stylish shade and privacy screens for balconies and terraces.'),
    heroImageUrl:    'https://cdn.shadesology.com/segments/balcony-hero.jpg',
    heroCta:         { label: t('Find Your Shade'), url: '/retractable-screen' },
    metaTitle:       t('Balcony Shade Solutions | Shadesology'),
    metaDescription: t('Retractable screens and blinds for balconies and terraces.'),
  },
  COMMERCIAL_HOSPITALITY: {
    heroHeadline:    t('Elevate Your Guest Experience'),
    heroSubheadline: t('Premium commercial shade systems for hotels, resorts and hospitality venues.'),
    heroImageUrl:    'https://cdn.shadesology.com/segments/hospitality-hero.jpg',
    heroCta:         { label: t('Request a Quote'), url: '/quote' },
    metaTitle:       t('Hospitality Shade Solutions | Shadesology'),
    metaDescription: t('Commercial shade systems for hotels, resorts and hospitality venues.'),
    enquiryQueue:    'commercial',
  },
  COMMERCIAL_RESTAURANT: {
    heroHeadline:    t('Extend Your Dining Space Outdoors'),
    heroSubheadline: t('Motorised awnings and pergolas that turn outdoor areas into all-weather dining.'),
    heroImageUrl:    'https://cdn.shadesology.com/segments/restaurant-hero.jpg',
    heroCta:         { label: t('Get a Quote'), url: '/quote' },
    metaTitle:       t('Restaurant & Café Shade | Shadesology'),
    metaDescription: t('Expand your outdoor seating with motorised awnings and pergolas.'),
    enquiryQueue:    'commercial',
  },
  COMMERCIAL_RETAIL: {
    heroHeadline:    t('Attract Customers with Eye-Catching Shade'),
    heroSubheadline: t('Custom awnings and canopies that reinforce your brand and protect shoppers.'),
    heroImageUrl:    'https://cdn.shadesology.com/segments/retail-hero.jpg',
    heroCta:         { label: t('Enquire Now'), url: '/quote' },
    metaTitle:       t('Retail Shade Solutions | Shadesology'),
    metaDescription: t('Custom commercial shade for retail shopfronts and shopping centres.'),
    enquiryQueue:    'commercial',
  },
  COMMERCIAL_OFFICE: {
    heroHeadline:    t('Create Comfortable Outdoor Workspaces'),
    heroSubheadline: t('Louvered roofs and pergolas designed for corporate outdoor environments.'),
    heroImageUrl:    'https://cdn.shadesology.com/segments/office-hero.jpg',
    heroCta:         { label: t('Contact Us'), url: '/contact' },
    metaTitle:       t('Office Shade Solutions | Shadesology'),
    metaDescription: t('Louvered roofs and pergolas for commercial office outdoor areas.'),
    enquiryQueue:    'commercial',
  },
  COMMERCIAL_HEALTHCARE: {
    heroHeadline:    t('Certified Shade for Healthcare Facilities'),
    heroSubheadline: t('Compliant shade solutions for hospitals, clinics and aged care facilities.'),
    heroImageUrl:    'https://cdn.shadesology.com/segments/healthcare-hero.jpg',
    heroCta:         { label: t('Enquire Now'), url: '/quote' },
    metaTitle:       t('Healthcare Shade Solutions | Shadesology'),
    metaDescription: t('Compliant shade solutions for healthcare and aged care facilities.'),
    enquiryQueue:    'commercial',
  },
  COMMERCIAL_EDUCATION: {
    heroHeadline:    t('Safe, Compliant Shade for Schools'),
    heroSubheadline: t('UPF 50+ shade structures for schools, universities and childcare centres.'),
    heroImageUrl:    'https://cdn.shadesology.com/segments/education-hero.jpg',
    heroCta:         { label: t('Get a Quote'), url: '/quote' },
    metaTitle:       t('Education Shade Solutions | Shadesology'),
    metaDescription: t('UPF 50+ shade structures for schools, universities and childcare.'),
    enquiryQueue:    'commercial',
  },
  COMMERCIAL_GOVERNMENT: {
    heroHeadline:    t('Engineered Shade for Public Spaces'),
    heroSubheadline: t('Durable shade structures meeting council and government specifications.'),
    heroImageUrl:    'https://cdn.shadesology.com/segments/government-hero.jpg',
    heroCta:         { label: t('Enquire Now'), url: '/quote' },
    metaTitle:       t('Government Shade Solutions | Shadesology'),
    metaDescription: t('Engineered shade structures for parks, councils and government facilities.'),
    enquiryQueue:    'commercial',
  },
  COMMERCIAL_SPORTS: {
    heroHeadline:    t('Weather Protection for Sports Facilities'),
    heroSubheadline: t('Shade structures for sports courts, pools and recreation areas.'),
    heroImageUrl:    'https://cdn.shadesology.com/segments/sports-hero.jpg',
    heroCta:         { label: t('Get a Quote'), url: '/quote' },
    metaTitle:       t('Sports & Recreation Shade | Shadesology'),
    metaDescription: t('Shade structures for sports courts, pools and recreation areas.'),
    enquiryQueue:    'commercial',
  },
  COMMERCIAL_INDUSTRIAL: {
    heroHeadline:    t('Heavy-Duty Shade for Industrial Applications'),
    heroSubheadline: t('Tensile structures and shade systems built for demanding industrial environments.'),
    heroImageUrl:    'https://cdn.shadesology.com/segments/industrial-hero.jpg',
    heroCta:         { label: t('Contact Us'), url: '/contact' },
    metaTitle:       t('Industrial Shade Solutions | Shadesology'),
    metaDescription: t('Heavy-duty tensile structures and shade systems for industrial use.'),
    enquiryQueue:    'commercial',
  },
  COMMERCIAL_PROPERTY_MGMT: {
    heroHeadline:    t('Enhance Property Value with Premium Shade'),
    heroSubheadline: t('Shade solutions for apartment complexes, commercial properties and strata.'),
    heroImageUrl:    'https://cdn.shadesology.com/segments/property-management-hero.jpg',
    heroCta:         { label: t('Enquire Now'), url: '/quote' },
    metaTitle:       t('Property Management Shade | Shadesology'),
    metaDescription: t('Shade solutions for apartment complexes, commercial properties and strata.'),
    enquiryQueue:    'commercial',
  },
};

// ─── Main ──────────────────────────────────────────────────────────────────────
const seed = async () => {
  await connectDB();

  if (isFresh) {
    console.log('🗑  Dropping homepage sections and segment pages...');
    await Promise.all([
      HomepageSection.deleteMany({}),
      SegmentPage.deleteMany({}),
    ]);
    console.log('✅  Cleared.\n');
  }

  // ── 1. Homepage sections ─────────────────────────────────────────────────────
  console.log('🏠  Seeding homepage sections...');
  for (const section of HOMEPAGE_SECTIONS) {
    await HomepageSection.findOneAndUpdate(
      { adminLabel: section.adminLabel },
      { $setOnInsert: section },
      { upsert: true, new: true }
    );
    console.log(`   ✓ ${section.adminLabel}`);
  }

  // ── 2. Segment pages ─────────────────────────────────────────────────────────
  console.log('\n📄  Seeding segment pages...');
  const segments = await Segment.find({}).lean();

  if (segments.length === 0) {
    console.warn('   ⚠️  No segments found — run seed.js first.');
  }

  for (const segment of segments) {
    const pageData = SEGMENT_PAGE_DATA[segment.code];
    if (!pageData) {
      console.warn(`   ⚠️  No page data for segment: ${segment.code}`);
      continue;
    }

    await SegmentPage.findOneAndUpdate(
      { segment: segment._id },
      {
        $setOnInsert: {
          segment:         segment._id,
          slug:            segment.slug,
          status:          'published',
          isActive:        true,
          enquiryQueue:    pageData.enquiryQueue || '',
          heroHeadline:    pageData.heroHeadline,
          heroSubheadline: pageData.heroSubheadline,
          heroImageUrl:    pageData.heroImageUrl,
          heroCta:         pageData.heroCta,
          metaTitle:       pageData.metaTitle,
          metaDescription: pageData.metaDescription,
          contentBlocks:   [],
          featuredProducts:[],
          testimonials:    [],
        },
      },
      { upsert: true, new: true }
    );
    console.log(`   ✓ ${segment.name.en} (${segment.code})`);
  }

  console.log('\n✅  Content seed complete!\n');
  await mongoose.connection.close();
  process.exit(0);
};

seed().catch((err) => {
  console.error('❌  Seed failed:', err);
  process.exit(1);
});
