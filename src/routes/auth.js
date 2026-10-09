const express = require('express');
const { createHash } = require('node:crypto');
const { authenticate } = require('../middlewares/authenticate');
const rateLimit = require('../middlewares/rateLimit');
const {
  register,
  login,
  logout,
  me,
  updateProfile,
  changePassword,
} = require('../controllers/auth/authController');
const {
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
} = require('../controllers/auth/emailController');

const router = express.Router();

const hashLoginEmail = (req) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return createHash('sha256').update(email).digest('hex');
};

// ─── Public routes (no auth required) ────────────────────────────────────────
router.post('/register', rateLimit({ windowMs: 60 * 60_000, max: 10, keyPrefix: 'rl:auth-register' }), register);
router.post(
  '/login',
  rateLimit({ windowMs: 15 * 60_000, max: 40, keyPrefix: 'rl:auth-login-ip' }),
  rateLimit({
    windowMs: 15 * 60_000,
    max: 10,
    keyPrefix: 'rl:auth-login-email',
    keyGenerator: hashLoginEmail,
  }),
  login
);
router.post('/forgot-password', rateLimit({ windowMs: 15 * 60_000, max: 5, keyPrefix: 'rl:auth-recovery' }), forgotPassword);
router.post('/reset-password/:token', rateLimit({ windowMs: 15 * 60_000, max: 10, keyPrefix: 'rl:auth-reset' }), resetPassword);
router.get('/verify-email/:token', rateLimit({ windowMs: 15 * 60_000, max: 20, keyPrefix: 'rl:auth-verify' }), verifyEmail);
router.post('/resend-verification', rateLimit({ windowMs: 15 * 60_000, max: 5, keyPrefix: 'rl:auth-resend' }), resendVerification);

// ─── Protected routes (valid session required) ────────────────────────────────
router.use(authenticate);

router.post('/logout',                      logout);
router.get('/me',                           me);
router.patch('/me',                         updateProfile);
router.post('/change-password',             changePassword);

module.exports = router;
