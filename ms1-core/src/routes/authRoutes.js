// ─────────────────────────────────────────────────────────────────────────────
// src/routes/authRoutes.js
// Auth Route Definitions
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const { register, login, verifyOtp, resendOtp, forgotPassword, resetPassword } = require('../controllers/authController');

const router = express.Router();

// POST /api/auth/register   → Create user, send OTP
router.post('/register', register);

// POST /api/auth/login      → Verify credentials, return JWT (or OTP gate)
router.post('/login', login);

// POST /api/auth/verify-otp → Validate OTP, mark verified, return JWT
router.post('/verify-otp', verifyOtp);

// POST /api/auth/resend-otp → Resend a fresh OTP to an unverified user
router.post('/resend-otp', resendOtp);

// POST /api/auth/forgot-password → Generate OTP for password reset and send via SES
router.post('/forgot-password', forgotPassword);

// POST /api/auth/reset-password → Verify OTP and set new password
router.post('/reset-password', resetPassword);

module.exports = router;
