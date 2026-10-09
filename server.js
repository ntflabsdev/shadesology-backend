'use strict';

require('dotenv').config();

const app             = require('./src/app');
const connectDB       = require('./src/config/db');
const emailWorker     = require('./src/workers/emailWorker');
const pdfWorker       = require('./src/workers/pdfWorker');
const quoteScheduler  = require('./src/workers/quoteScheduler');
const privacyWorker   = require('./src/workers/privacyWorker');
const crmSyncWorker   = require('./src/workers/crmSyncWorker');
const { closeAll: closeQueues } = require('./src/queues/index');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  // Connect to MongoDB first — fail fast if DB is unavailable
  await connectDB();

  // Start background workers (email queue etc.)
  // Workers connect to Redis lazily; if Redis is unavailable in dev, jobs queue up
  // and will be processed once Redis is started.
  emailWorker.start();
  pdfWorker.start();
  await quoteScheduler.start();
  privacyWorker.start();
  crmSyncWorker.start();

  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  });

  // ─── Graceful Shutdown ──────────────────────────────────────────────────────
  const shutdown = (signal) => {
    console.log(`\n⚠️  ${signal} received. Shutting down gracefully...`);
    server.close(async () => {
      console.log('✅ HTTP server closed.');
      await emailWorker.stop();
      await pdfWorker.stop();
      await quoteScheduler.stop();
      await privacyWorker.stop();
      await crmSyncWorker.stop();
      await closeQueues();
      process.exit(0);
    });

    // Force exit if server hasn't closed in 10s
    setTimeout(() => {
      console.error('❌ Forced shutdown after timeout.');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    console.error('💀 Unhandled Rejection:', reason);
    process.exit(1);
  });
};

startServer();
