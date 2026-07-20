// ─────────────────────────────────────────────────────────────────────────────
// src/controllers/authController.js
// Authentication Business Logic
//
// register:   Creates user (isVerified=false), sends OTP via SES (or console).
// verifyOtp:  Validates OTP (with brute-force protection), marks isVerified,
//             issues JWT. Entry point into the app for new users.
// resendOtp:  Invalidates old tokens, issues a fresh OTP for the same email.
// login:      Verifies credentials + JWT. If account unverified, returns
//             { requiresOtp: true } so the frontend can route to the OTP screen.
// ─────────────────────────────────────────────────────────────────────────────

const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const prisma  = require('../lib/prisma');
const { sendOtpEmail } = require('../lib/sesClient');

const SALT_ROUNDS    = 10;
const OTP_TTL_MIN    = 10;       // OTP expires after 10 minutes
const MAX_OTP_TRIES  = 5;        // Invalidate token after 5 wrong guesses

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generate a cryptographically-random 6-digit numeric OTP. */
const generateOtp = () => String(crypto.randomInt(100000, 999999));

/** Issue a signed JWT for a verified user. */
const issueToken = (user) =>
  jwt.sign(
    { userId: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );

/**
 * Create a fresh OTP token for a user.
 * Invalidates all previous tokens for the same user first.
 */
const createOtpToken = async (userId, plainOtp) => {
  // Invalidate any previous unused tokens for this user
  await prisma.otpToken.updateMany({
    where: { userId, used: false },
    data:  { used: true },
  });

  const codeHash  = await bcrypt.hash(plainOtp, SALT_ROUNDS);
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);

  return prisma.otpToken.create({
    data: { userId, codeHash, expiresAt },
  });
};


// ── POST /api/auth/register ───────────────────────────────────────────────────

const register = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'ValidationError', message: 'Email and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'ValidationError', message: 'Password must be at least 8 characters.' });
  }

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      // If they registered but never verified, let them resend via the resend endpoint
      if (!existingUser.isVerified) {
        return res.status(409).json({
          error:       'UnverifiedAccount',
          message:     'An unverified account with this email already exists. Please check your email for the OTP, or use resend.',
          requiresOtp: true,
          userId:      existingUser.id,
        });
      }
      return res.status(409).json({ error: 'Conflict', message: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const newUser = await prisma.user.create({
      data:   { email, passwordHash, isVerified: false },
      select: { id: true, email: true, role: true },
    });

    const otp = generateOtp();
    await createOtpToken(newUser.id, otp);

    try {
      await sendOtpEmail(email, otp);
    } catch (sesErr) {
      // If email delivery fails (e.g. SES Sandbox), roll back the user so
      // they can retry with a valid/verified email address instead of getting
      // permanently stuck on the OTP screen with no code.
      console.error('[authController] SES send failed — rolling back user creation:', sesErr.message);
      await prisma.otpToken.deleteMany({ where: { userId: newUser.id } });
      await prisma.user.delete({ where: { id: newUser.id } });

      // Detect SES Sandbox rejection specifically
      if (sesErr.Code === 'MessageRejected' || sesErr?.Error?.Code === 'MessageRejected') {
        return res.status(400).json({
          error:   'EmailNotVerified',
          message: 'This email address has not been verified with our mail provider. Please contact the administrator to whitelist your email, or try a different address.',
        });
      }
      return res.status(503).json({ error: 'EmailDeliveryFailed', message: 'Could not send verification email. Please try again later.' });
    }

    console.log(`[authController] 🆕 User registered (unverified): ${email}`);
    return res.status(201).json({
      message:     'Account created. Please verify your email with the OTP sent to you.',
      requiresOtp: true,
      userId:      newUser.id,
    });
  } catch (err) {
    console.error('[authController] register error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Registration failed.' });
  }
};


// ── POST /api/auth/verify-otp ─────────────────────────────────────────────────

const verifyOtp = async (req, res) => {
  const { userId, otp } = req.body;

  if (!userId || !otp) {
    return res.status(400).json({ error: 'ValidationError', message: 'userId and otp are required.' });
  }

  try {
    // Find the most recent active token for this user
    const token = await prisma.otpToken.findFirst({
      where:   { userId, used: false },
      orderBy: { createdAt: 'desc' },
    });

    if (!token) {
      return res.status(400).json({ error: 'InvalidOtp', message: 'No active OTP found. Please request a new one.' });
    }

    // Check expiry
    if (token.expiresAt < new Date()) {
      await prisma.otpToken.update({ where: { id: token.id }, data: { used: true } });
      return res.status(400).json({ error: 'OtpExpired', message: 'OTP has expired. Please request a new one.' });
    }

    // Check brute-force limit
    if (token.attempts >= MAX_OTP_TRIES) {
      await prisma.otpToken.update({ where: { id: token.id }, data: { used: true } });
      return res.status(429).json({ error: 'TooManyAttempts', message: 'Too many incorrect attempts. Please request a new OTP.' });
    }

    // Verify the code
    const valid = await bcrypt.compare(String(otp), token.codeHash);
    if (!valid) {
      await prisma.otpToken.update({ where: { id: token.id }, data: { attempts: { increment: 1 } } });
      const remaining = MAX_OTP_TRIES - (token.attempts + 1);
      return res.status(400).json({
        error:   'InvalidOtp',
        message: `Incorrect OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      });
    }

    // ✅ OTP is valid — mark used, mark user verified, issue JWT
    await prisma.otpToken.update({ where: { id: token.id }, data: { used: true } });
    const user = await prisma.user.update({
      where:  { id: userId },
      data:   { isVerified: true },
      select: { id: true, email: true, role: true },
    });

    const jwtToken = issueToken(user);
    console.log(`[authController] ✅ Email verified + logged in: ${user.email}`);
    return res.status(200).json({
      message: 'Email verified successfully.',
      token:   jwtToken,
      user:    { id: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error('[authController] verifyOtp error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'OTP verification failed.' });
  }
};


// ── POST /api/auth/resend-otp ─────────────────────────────────────────────────

const resendOtp = async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'ValidationError', message: 'userId is required.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, isVerified: true } });

    if (!user) {
      return res.status(404).json({ error: 'NotFound', message: 'User not found.' });
    }
    if (user.isVerified) {
      return res.status(400).json({ error: 'AlreadyVerified', message: 'This account is already verified.' });
    }

    const otp = generateOtp();
    await createOtpToken(user.id, otp);
    await sendOtpEmail(user.email, otp);

    console.log(`[authController] 🔄 OTP resent to: ${user.email}`);
    return res.status(200).json({ message: 'A new OTP has been sent to your email.' });
  } catch (err) {
    console.error('[authController] resendOtp error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Resend failed.' });
  }
};


// ── POST /api/auth/login ──────────────────────────────────────────────────────

const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'ValidationError', message: 'Email and password are required.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(401).json({ error: 'InvalidCredentials', message: 'Invalid email or password.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'InvalidCredentials', message: 'Invalid email or password.' });
    }

    // Guard: account exists but email was never verified
    if (!user.isVerified) {
      // Re-send OTP so they can complete verification
      const otp = generateOtp();
      await createOtpToken(user.id, otp);
      await sendOtpEmail(email, otp);
      console.log(`[authController] ⚠️  Login blocked — unverified account: ${email} (OTP resent)`);
      return res.status(403).json({
        error:       'EmailNotVerified',
        message:     'Please verify your email before logging in. A new OTP has been sent.',
        requiresOtp: true,
        userId:      user.id,
      });
    }

    const token = issueToken(user);
    console.log(`[authController] ✅ User logged in: ${user.email}`);
    return res.status(200).json({
      message: 'Login successful.',
      token,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error('[authController] login error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Login failed.' });
  }
};


module.exports = { register, login, verifyOtp, resendOtp };
