/**
 * Nav + Footer + Legal pages seed.
 *
 * Usage:
 *   node src/seeds/seedNav.js
 *   node src/seeds/seedNav.js --fresh
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const mongoose    = require('mongoose');
const connectDB   = require('../config/db');
const NavMenu     = require('../models/NavMenu');
const FooterConfig= require('../models/FooterConfig');
const LegalPage   = require('../models/LegalPage');

const isFresh = process.argv.includes('--fresh');
const t = (en, es = '') => ({ en, es, de: '', fr: '', it: '', pt: '' });

// ─── Nav menus ────────────────────────────────────────────────────────────────
const MENUS = [
  {
    type:       'main',
    adminLabel: 'Main Navigation (Desktop Mega Menu)',
    items: [
      {
        label:       t('Products'),
        url:         '/products',
        type:        'mega',
        autoCatalog: true,   // columns auto-populated from Category model
        ctas: [
          { label: t('View All Products'), url: '/products', style: 'primary' },
          { label: t('Get a Quote'),       url: '/quote',    style: 'secondary' },
        ],
        isActive:  true,
        sortOrder: 1,
      },
      {
        label:     t('Inspiration'),
        url:       '/inspiration',
        type:      'dropdown',
        children: [
          { heading: t('Inspiration'), url: '/inspiration', image: { url: '', alt: t('') }, children: [
            { label: t('Inspiration Gallery'), url: '/inspiration',       isActive: true, sortOrder: 1 },
            { label: t('Project Gallery'),     url: '/projects',          isActive: true, sortOrder: 2 },
            { label: t('Video Library'),       url: '/videos',            isActive: true, sortOrder: 3 },
            { label: t('Case Studies'),        url: '/case-studies',      isActive: true, sortOrder: 4 },
          ], isActive: true, sortOrder: 1 },
        ],
        isActive:  true,
        sortOrder: 2,
      },
      {
        label:     t('Learn'),
        url:       '/learn',
        type:      'dropdown',
        children: [
          { heading: t('Resources'), url: '', image: { url: '', alt: t('') }, children: [
            { label: t('Buying Guides'),   url: '/guides',              isActive: true, sortOrder: 1 },
            { label: t('Learning Center'), url: '/learn',               isActive: true, sortOrder: 2 },
            { label: t('Blog'),            url: '/blog',                isActive: true, sortOrder: 3 },
            { label: t('Glossary'),        url: '/glossary',            isActive: true, sortOrder: 4 },
            { label: t('Resource Library'),url: '/resources',           isActive: true, sortOrder: 5 },
            { label: t('Calculators'),     url: '/calculators',         isActive: true, sortOrder: 6 },
          ], isActive: true, sortOrder: 1 },
        ],
        isActive:  true,
        sortOrder: 3,
      },
      {
        label:     t('Commercial'),
        url:       '/commercial',
        type:      'dropdown',
        children: [
          { heading: t('Commercial'), url: '', image: { url: '', alt: t('') }, children: [
            { label: t('Commercial Overview'), url: '/commercial',              isActive: true, sortOrder: 1 },
            { label: t('Specifier Portal'),    url: '/specifier',               isActive: true, sortOrder: 2 },
            { label: t('Dealer Portal'),       url: '/dealer',                  isActive: true, sortOrder: 3 },
            { label: t('Find an Installer'),   url: '/find-installer',          isActive: true, sortOrder: 4 },
          ], isActive: true, sortOrder: 1 },
        ],
        isActive:  true,
        sortOrder: 4,
      },
      {
        label:     t('Support'),
        url:       '/support',
        type:      'link',
        isActive:  true,
        sortOrder: 5,
      },
    ],
  },
  {
    type:       'mobile',
    adminLabel: 'Mobile Navigation',
    items: [
      { label: t('Products'),    url: '/products',       type: 'dropdown', autoCatalog: true, isActive: true, sortOrder: 1 },
      { label: t('Inspiration'), url: '/inspiration',    type: 'link',     isActive: true, sortOrder: 2 },
      { label: t('Learn'),       url: '/learn',          type: 'link',     isActive: true, sortOrder: 3 },
      { label: t('Commercial'),  url: '/commercial',     type: 'link',     isActive: true, sortOrder: 4 },
      { label: t('Support'),     url: '/support',        type: 'link',     isActive: true, sortOrder: 5 },
      { label: t('Get a Quote'), url: '/quote',          type: 'link',     isActive: true, sortOrder: 6 },
      { label: t('Find Installer'), url: '/find-installer', type: 'link', isActive: true, sortOrder: 7 },
    ],
  },
];

// ─── Footer ───────────────────────────────────────────────────────────────────
const FOOTER = {
  phone: '1-800-SHADES-0',
  email: 'hello@shadesology.com',
  address: t('123 Shade Street, Miami, FL 33101'),

  linkGroups: [
    {
      heading: t('Products'),
      isActive: true,
      sortOrder: 1,
      links: [
        { label: t('Retractable Awnings'),  url: '/category/retractable-awning',   isActive: true, sortOrder: 1 },
        { label: t('Fabric Pergolas'),      url: '/category/fabric-pergola',        isActive: true, sortOrder: 2 },
        { label: t('Louvered Roofs'),       url: '/category/louvered-roof',         isActive: true, sortOrder: 3 },
        { label: t('Shade Sails'),          url: '/category/shade-sail',            isActive: true, sortOrder: 4 },
        { label: t('Retractable Screens'),  url: '/category/retractable-screen',    isActive: true, sortOrder: 5 },
        { label: t('Pool Covers'),          url: '/category/pool-cover',            isActive: true, sortOrder: 6 },
      ],
    },
    {
      heading: t('Company'),
      isActive: true,
      sortOrder: 2,
      links: [
        { label: t('About Us'),    url: '/about',          isActive: true, sortOrder: 1 },
        { label: t('Blog'),        url: '/blog',           isActive: true, sortOrder: 2 },
        { label: t('Careers'),     url: '/careers',        isActive: true, sortOrder: 3 },
        { label: t('Press'),       url: '/press',          isActive: true, sortOrder: 4 },
        { label: t('Contact Us'),  url: '/contact',        isActive: true, sortOrder: 5 },
      ],
    },
    {
      heading: t('Support'),
      isActive: true,
      sortOrder: 3,
      links: [
        { label: t('Support Center'),       url: '/support',         isActive: true, sortOrder: 1 },
        { label: t('Find an Installer'),    url: '/find-installer',  isActive: true, sortOrder: 2 },
        { label: t('Warranty'),             url: '/warranty',        isActive: true, sortOrder: 3 },
        { label: t('Returns & Refunds'),    url: '/refunds',         isActive: true, sortOrder: 4 },
        { label: t('Shipping Policy'),      url: '/shipping-policy', isActive: true, sortOrder: 5 },
      ],
    },
    {
      heading: t('Trade'),
      isActive: true,
      sortOrder: 4,
      links: [
        { label: t('Dealer Program'),       url: '/dealer',          isActive: true, sortOrder: 1 },
        { label: t('Installer Network'),    url: '/find-installer',  isActive: true, sortOrder: 2 },
        { label: t('Specifier Portal'),     url: '/specifier',       isActive: true, sortOrder: 3 },
        { label: t('Commercial Projects'),  url: '/commercial',      isActive: true, sortOrder: 4 },
      ],
    },
  ],

  socialLinks: [
    { platform: 'instagram', url: 'https://instagram.com/shadesology', isActive: true, sortOrder: 1 },
    { platform: 'facebook',  url: 'https://facebook.com/shadesology',  isActive: true, sortOrder: 2 },
    { platform: 'pinterest', url: 'https://pinterest.com/shadesology', isActive: true, sortOrder: 3 },
    { platform: 'youtube',   url: 'https://youtube.com/@shadesology',  isActive: true, sortOrder: 4 },
    { platform: 'houzz',     url: 'https://houzz.com/pro/shadesology', isActive: true, sortOrder: 5 },
  ],

  newsletterHeading:    t('Stay in the Shade'),
  newsletterSubheading: t('Inspiration, tips and exclusive offers — straight to your inbox.'),
  newsletterEnabled:    true,

  copyrightText: t(`© ${new Date().getFullYear()} Shadesology. All rights reserved.`),
  legalLinks: [
    { label: t('Privacy Policy'),      url: '/privacy' },
    { label: t('Terms of Service'),    url: '/terms' },
    { label: t('Refund Policy'),       url: '/refunds' },
    { label: t('Accessibility'),       url: '/accessibility' },
  ],
};

// ─── Legal pages ──────────────────────────────────────────────────────────────
const LEGAL_PAGES = [
  {
    key: 'privacy', slug: 'privacy', pageType: 'legal', sortOrder: 1,
    title: t('Privacy Policy'),
    content: t('Privacy policy content — to be completed by client legal team.'),
    metaTitle: t('Privacy Policy | Shadesology'),
    metaDescription: t('Read our privacy policy to learn how we collect and use your data.'),
  },
  {
    key: 'terms', slug: 'terms', pageType: 'legal', sortOrder: 2,
    title: t('Terms of Service'),
    content: t('Terms of service content — to be completed by client legal team.'),
    metaTitle: t('Terms of Service | Shadesology'),
    metaDescription: t('Read our terms of service for information about using Shadesology.com.'),
  },
  {
    key: 'refunds', slug: 'refunds', pageType: 'legal', sortOrder: 3,
    title: t('Refund & Return Policy'),
    content: t('Refund and return policy — to be completed by client. Note: made-to-order products have different terms.'),
    metaTitle: t('Refund Policy | Shadesology'),
    metaDescription: t('Our return and refund policy for shade products. Made-to-order items have specific terms.'),
  },
  {
    key: 'accessibility', slug: 'accessibility', pageType: 'legal', sortOrder: 4,
    title: t('Accessibility Statement'),
    content: t('Shadesology is committed to ensuring digital accessibility. This statement will be completed following WCAG 2.1 AA audit.'),
    metaTitle: t('Accessibility Statement | Shadesology'),
    metaDescription: t('Our commitment to web accessibility and WCAG 2.1 AA compliance.'),
  },
  {
    key: 'cookie-policy', slug: 'cookie-policy', pageType: 'legal', sortOrder: 5,
    title: t('Cookie Policy'),
    content: t('Cookie policy content — describes types of cookies used and how to manage them.'),
    metaTitle: t('Cookie Policy | Shadesology'),
    metaDescription: t('Learn about the cookies we use on Shadesology.com and how to manage your preferences.'),
  },
  {
    key: 'shipping-policy', slug: 'shipping-policy', pageType: 'legal', sortOrder: 6,
    title: t('Shipping Policy'),
    content: t('Shipping policy — lead times, freight classes, and delivery estimates. To be completed.'),
    metaTitle: t('Shipping Policy | Shadesology'),
    metaDescription: t('Information about our shipping, freight and delivery process for shade products.'),
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
const seed = async () => {
  await connectDB();

  if (isFresh) {
    console.log('🗑  Dropping nav, footer, legal pages...');
    await Promise.all([
      NavMenu.deleteMany({}),
      FooterConfig.deleteMany({}),
      LegalPage.deleteMany({}),
    ]);
  }

  // Menus
  console.log('\n🧭  Seeding nav menus...');
  for (const menu of MENUS) {
    await NavMenu.findOneAndUpdate(
      { type: menu.type },
      { $setOnInsert: menu },
      { upsert: true, new: true }
    );
    console.log(`   ✓ ${menu.adminLabel}`);
  }

  // Footer
  console.log('\n🦶  Seeding footer config...');
  const existing = await FooterConfig.findOne();
  if (!existing) {
    await FooterConfig.create(FOOTER);
    console.log('   ✓ Footer config created');
  } else {
    console.log('   ℹ  Footer already exists — skipped (use --fresh to reset)');
  }

  // Legal pages
  console.log('\n📄  Seeding legal pages...');
  for (const page of LEGAL_PAGES) {
    await LegalPage.findOneAndUpdate(
      { key: page.key },
      { $setOnInsert: page },
      { upsert: true, new: true }
    );
    console.log(`   ✓ ${page.title.en}`);
  }

  console.log('\n✅  Nav seed complete!\n');
  await mongoose.connection.close();
  process.exit(0);
};

seed().catch((err) => {
  console.error('❌  Seed failed:', err);
  process.exit(1);
});
