/**
 * Seed Admin User + Test Customer
 *
 * Usage:
 *   node src/seeds/seedAdmin.js
 *
 * Creates (or skips if already exists):
 *   admin@shadesology.com / Admin@1234   (role: staff, staffRole: admin)
 *   customer@shadesology.com / Test@1234 (role: customer, emailVerified)
 */

const dotenv = require('dotenv');
const path   = require('node:path');
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');

async function seed() {
  await connectDB();

  const users = [
    {
      firstName:       'Admin',
      lastName:        'User',
      email:           'admin@shadesology.com',
      passwordHash:    'Admin@1234',
      role:            'staff',
      staffRole:       'admin',
      isEmailVerified: true,
      isActive:        true,
    },
    {
      firstName:       'Test',
      lastName:        'Customer',
      email:           'customer@shadesology.com',
      passwordHash:    'Test@1234',
      role:            'customer',
      staffRole:       '',
      isEmailVerified: true,
      isActive:        true,
    },
  ];

  for (const u of users) {
    const existing = await User.findOne({ email: u.email });
    if (existing) {
      console.log(`  ✓ already exists: ${u.email}`);
    } else {
      await User.create(u);
      console.log(`  ✓ created: ${u.email} (${u.role})`);
    }
  }

  console.log('Admin seed complete.');
  await mongoose.disconnect();
}

seed().catch((err) => { console.error(err); process.exit(1); });
