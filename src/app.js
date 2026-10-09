const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const requestLogger = require('./middlewares/requestLogger');
const { errorHandler } = require('./middlewares/errorHandler');
const healthRouter    = require('./routes/health');
const authRouter      = require('./routes/auth');
const approvalsRouter = require('./routes/approvals');
const homepageRouter  = require('./routes/homepage');
const segmentsRouter  = require('./routes/segments');
const navRouter       = require('./routes/nav');
const footerRouter    = require('./routes/footer');
const searchRouter    = require('./routes/search');
const contentRouter   = require('./routes/content');
const categoriesRouter= require('./routes/categories');
const productsRouter  = require('./routes/products');
const comparisonRouter = require('./routes/comparison');
const adminRouter     = require('./routes/admin/index');
const quotesRouter    = require('./routes/quotes');
const cartRouter      = require('./routes/cart');
const installersRouter = require('./routes/installers');
const ordersRouter    = require('./routes/orders');
const downloadsRouter = require('./routes/downloads');
const reviewsRouter   = require('./routes/reviews');
const shippingRouter  = require('./routes/shipping');
const paymentWebhookRouter = require('./routes/paymentWebhooks');
const paymentsRouter = require('./routes/payments');
const financingRouter = require('./routes/financing');
const privacyRouter = require('./routes/privacy');
const payloadContentRouter = require('./routes/payloadContent');
const phase3ContentRouter = require('./routes/phase3Content');

const app = express();

const proxyHops = process.env.TRUST_PROXY_HOPS;
if (proxyHops !== undefined) {
  const parsedProxyHops = Number(proxyHops);
  if (!Number.isSafeInteger(parsedProxyHops) || parsedProxyHops < 0) {
    throw new Error('TRUST_PROXY_HOPS must be a non-negative integer.');
  }
  app.set('trust proxy', parsedProxyHops);
}

// ─── Security & CORS ─────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  if (process.env.NODE_ENV === 'production') {
    res.set('Strict-Transport-Security', 'max-age=31536000');
  }
  next();
});

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true, // required for HttpOnly cookies
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Stripe signature verification requires the untouched request body bytes.
app.use('/api/webhooks', paymentWebhookRouter);

// ─── Core Middleware ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(requestLogger);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/health',        healthRouter);
app.use('/api/auth',      authRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/homepage',  homepageRouter);
app.use('/api/segments',  segmentsRouter);
app.use('/api/nav',       navRouter);
app.use('/api/footer',    footerRouter);
app.use('/api/search',    searchRouter);
app.use('/api/content',   contentRouter);
app.use('/api/categories',categoriesRouter);
app.use('/api/products',  productsRouter);
app.use('/api/compare',   comparisonRouter);
app.use('/api/quotes',    quotesRouter);
app.use('/api/cart',       cartRouter);
app.use('/api/installers', installersRouter);
app.use('/api/orders',     ordersRouter);
app.use('/api/downloads',  downloadsRouter);
app.use('/api/reviews',    reviewsRouter);
app.use('/api/shipping',   shippingRouter);
app.use('/api/payments',   paymentsRouter);
app.use('/api/financing',  financingRouter);
app.use('/api/privacy',   privacyRouter);
app.use('/api/cms',       payloadContentRouter);
app.use('/api',           phase3ContentRouter);
app.use('/admin',         adminRouter);

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// ─── Central Error Handler (must be last) ────────────────────────────────────
app.use(errorHandler);

module.exports = app;
