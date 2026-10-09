const User = require('../../models/User');
const AuditLog = require('../../models/AuditLog');
const { signToken, setAuthCookie } = require('../../utils/jwt');
const { generateToken, hashToken } = require('../../utils/crypto');
const { createError } = require('../../middlewares/errorHandler');
const { getQueue } = require('../../queues/index');

// ─── Email helpers ─────────────────────────────────────────────────────────────
/**
 * Enqueue a transactional email via the SES job queue.
 * Failures are retried automatically; the auth flow is never blocked.
 */
function enqueueEmail(opts) {
  try {
    getQueue('email').add('send', opts, { attempts: 5 }).catch((err) => {
      console.error('[Auth] failed to enqueue email:', err.message);
    });
  } catch {
    // Redis not running in dev — log and continue
    console.warn('[Auth] email queue not available; email not sent:', opts.to, opts.subject);
  }
}

// ─── Verify Email ─────────────────────────────────────────────────────────────
const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.params;
    if (!token) return next(createError(400, 'Verification token is required.'));

    const hashedToken = hashToken(token);

    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: new Date() },
    }).select('+emailVerificationToken +emailVerificationExpires +tokenVersion');

    if (!user) {
      return next(createError(400, 'Verification link is invalid or has expired.'));
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    await user.save({ validateBeforeSave: false });

    // Auto-login after verification
    const jwtToken = signToken(user);
    setAuthCookie(res, jwtToken);

    res.json({
      success: true,
      message: 'Email verified successfully.',
      user: user.toJSON(),
    });
  } catch (err) {
    next(err);
  }
};

// ─── Resend Verification Email ────────────────────────────────────────────────
const resendVerification = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return next(createError(400, 'Email is required.'));

    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select('+emailVerificationToken +emailVerificationExpires');

    // Always return 200 — don't reveal whether email exists
    if (!user || user.isEmailVerified) {
      return res.json({ success: true, message: 'If that account exists and is unverified, a new email has been sent.' });
    }

    const rawToken = generateToken();
    user.emailVerificationToken = hashToken(rawToken);
    user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    // Enqueue verification email via SES queue
    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email/${rawToken}`;
    enqueueEmail({
      to:      user.email,
      subject: 'Verify your Shadesology email address',
      html: `
        <h2 style="color:#1B4332">Verify your email</h2>
        <p>We received a request to resend your verification link.</p>
        <p><a href="${verifyUrl}" style="background:#1B4332;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">Verify Email Address</a></p>
        <p style="color:#6B7280;font-size:14px">This link expires in 24 hours.</p>
      `,
      text: `Verify your Shadesology email: ${verifyUrl}\n\nExpires in 24 hours.`,
    });

    res.json({
      success: true,
      message: 'If that account exists and is unverified, a new email has been sent.',
      ...(process.env.NODE_ENV === 'development' && { _devVerifyToken: rawToken }),
    });
  } catch (err) {
    next(err);
  }
};

// ─── Forgot Password ─────────────────────────────────────────────────────────
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return next(createError(400, 'Email is required.'));

    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select('+passwordResetToken +passwordResetExpires');

    // Always 200 — don't reveal account existence
    if (!user) {
      return res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
    }

    const rawToken = generateToken();
    user.passwordResetToken = hashToken(rawToken);
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1h
    await user.save({ validateBeforeSave: false });

    // Enqueue password reset email via SES queue
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${rawToken}`;
    enqueueEmail({
      to:      user.email,
      subject: 'Reset your Shadesology password',
      html: `
        <h2 style="color:#1B4332">Reset your password</h2>
        <p>We received a request to reset the password for your Shadesology account.</p>
        <p><a href="${resetUrl}" style="background:#1B4332;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">Reset Password</a></p>
        <p style="color:#6B7280;font-size:14px">This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
      `,
      text: `Reset your Shadesology password: ${resetUrl}\n\nExpires in 1 hour.`,
    });

    await AuditLog.record({
      event: 'password_reset',
      subject: user._id,
      subjectEmail: user.email,
      meta: { action: 'forgot_password_requested' },
      ip: req.ip,
    });

    res.json({
      success: true,
      message: 'If that email is registered, a reset link has been sent.',
      ...(process.env.NODE_ENV === 'development' && { _devResetToken: rawToken }),
    });
  } catch (err) {
    next(err);
  }
};

// ─── Reset Password ───────────────────────────────────────────────────────────
const resetPassword = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!token) return next(createError(400, 'Reset token is required.'));
    if (!password || password.length < 8) {
      return next(createError(400, 'Password must be at least 8 characters.'));
    }

    const hashedToken = hashToken(token);

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() },
    }).select('+passwordResetToken +passwordResetExpires +passwordHash +tokenVersion');

    if (!user) {
      return next(createError(400, 'Reset link is invalid or has expired.'));
    }

    user.passwordHash = password;      // pre-save re-hashes
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    user.tokenVersion += 1;            // revoke all existing sessions

    await user.save();

    await AuditLog.record({
      event: 'password_reset',
      subject: user._id,
      subjectEmail: user.email,
      meta: { action: 'password_reset_completed' },
      ip: req.ip,
    });

    res.json({ success: true, message: 'Password has been reset. Please log in with your new password.' });
  } catch (err) {
    next(err);
  }
};

// ─── Admin: Revoke all sessions for a user ───────────────────────────────────
const revokeUserSessions = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select('+tokenVersion');
    if (!user) return next(createError(404, 'User not found.'));

    await user.revokeAllSessions();

    await AuditLog.record({
      event: 'session_revoked',
      actor: req.user._id,
      actorEmail: req.user.email,
      subject: user._id,
      subjectEmail: user.email,
      ip: req.ip,
    });

    res.json({ success: true, message: 'All sessions revoked for this user.' });
  } catch (err) {
    next(err);
  }
};

module.exports = { verifyEmail, resendVerification, forgotPassword, resetPassword, revokeUserSessions };
