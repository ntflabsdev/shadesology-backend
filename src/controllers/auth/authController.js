const User = require('../../models/User');
const AuditLog = require('../../models/AuditLog');
const { signToken, setAuthCookie, clearAuthCookie } = require('../../utils/jwt');
const { generateToken, hashToken } = require('../../utils/crypto');
const { createError } = require('../../middlewares/errorHandler');
const { getQueue } = require('../../queues/index');

/**
 * Enqueue a transactional email without blocking the auth flow.
 * Falls back gracefully if Redis / the email worker is unavailable in dev.
 */
function enqueueEmail(opts) {
  try {
    getQueue('email').add('send', opts, { attempts: 5 }).catch((err) => {
      console.error('[Auth] failed to enqueue email:', err.message);
    });
  } catch {
    console.warn('[Auth] email queue unavailable; email not sent to:', opts.to);
  }
}

// ─── Register ─────────────────────────────────────────────────────────────────
const register = async (req, res, next) => {
  try {
    const { firstName, lastName, email, password, phone } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return next(createError(400, 'firstName, lastName, email and password are required.'));
    }

    if (password.length < 8) {
      return next(createError(400, 'Password must be at least 8 characters.'));
    }

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return next(createError(409, 'An account with this email already exists.'));
    }

    // Generate email verification token (store hash, send raw)
    const rawVerifyToken = generateToken();
    const hashedVerifyToken = hashToken(rawVerifyToken);

    const user = await User.create({
      firstName,
      lastName,
      email,
      phone: phone || '',
      passwordHash: password,           // pre-save hook hashes this
      role: 'customer',
      emailVerificationToken: hashedVerifyToken,
      emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
    });

    // Enqueue verification email via SES queue (non-blocking)
    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email/${rawVerifyToken}`;
    enqueueEmail({
      to:      email.toLowerCase().trim(),
      subject: 'Verify your Shadesology account',
      html: `
        <h2 style="color:#1B4332">Welcome to Shadesology!</h2>
        <p>Thank you for creating an account. Please verify your email address:</p>
        <p><a href="${verifyUrl}" style="background:#1B4332;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">Verify Email Address</a></p>
        <p style="color:#6B7280;font-size:14px">This link expires in 24 hours. If you did not create an account, you can safely ignore this email.</p>
      `,
      text: `Welcome to Shadesology!\n\nVerify your email: ${verifyUrl}\n\nThis link expires in 24 hours.`,
    });

    await AuditLog.record({
      event: 'login',
      subject: user._id,
      subjectEmail: user.email,
      meta: { action: 'register' },
      ip: req.ip,
      userAgent: req.headers['user-agent'] || '',
    });

    res.status(201).json({
      success: true,
      message: 'Account created. Please check your email to verify your account.',
      // In development, expose the token so it can be verified without email setup
      ...(process.env.NODE_ENV === 'development' && { _devVerifyToken: rawVerifyToken }),
    });
  } catch (err) {
    next(err);
  }
};

// ─── Login ────────────────────────────────────────────────────────────────────
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(createError(400, 'Email and password are required.'));
    }

    // Explicitly select passwordHash (excluded by default)
    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select('+passwordHash +tokenVersion');

    if (!user) {
      // Generic message — don't reveal whether email exists
      await AuditLog.record({ event: 'login_failed', meta: { email }, ip: req.ip });
      return next(createError(401, 'Invalid email or password.'));
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      await AuditLog.record({
        event: 'login_failed',
        subject: user._id,
        subjectEmail: user.email,
        meta: { reason: 'wrong_password' },
        ip: req.ip,
      });
      return next(createError(401, 'Invalid email or password.'));
    }

    if (!user.isActive) {
      return next(createError(403, 'Your account has been suspended. Please contact support.'));
    }

    // Update last login
    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });

    const token = signToken(user);
    setAuthCookie(res, token);

    await AuditLog.record({
      event: 'login',
      actor: user._id,
      actorEmail: user.email,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || '',
    });

    res.json({
      success: true,
      user: user.toJSON(),
      mergeCart: true, // client should call POST /api/cart/merge after login
    });
  } catch (err) {
    next(err);
  }
};

// ─── Logout ───────────────────────────────────────────────────────────────────
const logout = async (req, res, next) => {
  try {
    clearAuthCookie(res);
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
};

// ─── Me ───────────────────────────────────────────────────────────────────────
const me = async (req, res, next) => {
  try {
    // req.user already populated by authenticate middleware
    const user = await User.findById(req.user._id).populate('company', 'name type pricingGroup');
    if (!user) return next(createError(404, 'User not found.'));
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
};

// ─── Update profile ───────────────────────────────────────────────────────────
const updateProfile = async (req, res, next) => {
  try {
    const allowed = ['firstName', 'lastName', 'phone', 'locale', 'units', 'currency', 'marketingConsent', 'addresses'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
};

// ─── Change password ──────────────────────────────────────────────────────────
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return next(createError(400, 'currentPassword and newPassword are required.'));
    }
    if (newPassword.length < 8) {
      return next(createError(400, 'New password must be at least 8 characters.'));
    }

    const user = await User.findById(req.user._id).select('+passwordHash +tokenVersion');
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return next(createError(401, 'Current password is incorrect.'));
    }

    user.passwordHash = newPassword; // pre-save hook re-hashes
    user.tokenVersion += 1;          // revoke all other sessions
    await user.save();

    // Re-issue cookie for the current session
    const token = signToken(user);
    setAuthCookie(res, token);

    await AuditLog.record({
      event: 'password_reset',
      actor: user._id,
      actorEmail: user.email,
      meta: { source: 'self' },
      ip: req.ip,
    });

    res.json({ success: true, message: 'Password updated. All other sessions have been signed out.' });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, logout, me, updateProfile, changePassword };
