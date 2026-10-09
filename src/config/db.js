const mongoose = require('mongoose');

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

/**
 * Connect to MongoDB with retry logic.
 * Retries up to MAX_RETRIES times before giving up.
 */
const connectDB = async (attempt = 1) => {
  try {
    const databaseUri = process.env.DATABASE_URI || process.env.MONGODB_URI;
    if (!databaseUri) {
      throw new Error('DATABASE_URI (or legacy MONGODB_URI) is required.');
    }

    const conn = await mongoose.connect(databaseUri, {
      dbName: process.env.DB_NAME || 'shadesology',
    });

    console.log(`✅ MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB connection failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`);

    if (attempt < MAX_RETRIES) {
      console.log(`🔄 Retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return connectDB(attempt + 1);
    }

    console.error('💀 Max retries reached. Exiting process.');
    process.exit(1);
  }
};

module.exports = connectDB;
