// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sesClient.js
// AWS SES Email Sender — with dev-mode terminal fallback
//
// If AWS credentials are not configured (no AWS_ACCESS_KEY_ID in env),
// the OTP is logged to stdout instead of being emailed. This lets the full
// signup flow work locally without AWS access. In production, add
// AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, and SES_FROM_EMAIL
// to the .env and real emails will be sent automatically.
// ─────────────────────────────────────────────────────────────────────────────

const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const AWS_CONFIGURED = !!(
  process.env.AWS_ACCESS_KEY_ID &&
  process.env.AWS_SECRET_ACCESS_KEY &&
  process.env.AWS_REGION
);

let sesClient = null;
if (AWS_CONFIGURED) {
  sesClient = new SESClient({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  console.log('[sesClient] ✅ AWS SES client initialized — emails will be sent');
} else {
  console.warn(
    '[sesClient] ⚠️  AWS credentials not configured. ' +
    'OTPs will be logged to console (dev mode). ' +
    'Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, SES_FROM_EMAIL to enable real emails.'
  );
}

/**
 * Sends an OTP verification email.
 * Falls back to console.log when AWS credentials are absent.
 *
 * @param {string} toEmail    — Recipient email address
 * @param {string} otp        — Plaintext 6-digit OTP (only used in dev log; never persisted)
 * @returns {Promise<void>}
 */
const sendOtpEmail = async (toEmail, otp) => {
  if (!AWS_CONFIGURED || !sesClient) {
    // ── Dev-mode fallback ────────────────────────────────────────────────────
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  [DEV MODE] OTP for ${toEmail}:`);
    console.log(`  ▶  ${otp}  ◀`);
    console.log('  (Add AWS credentials to .env to send real emails)');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    return;
  }

  const FROM = process.env.SES_FROM_EMAIL;
  if (!FROM) {
    throw new Error('SES_FROM_EMAIL env var is required when AWS credentials are configured.');
  }

  const htmlBody = `
  <div style="font-family: Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #F8FAFC; border-radius: 12px;">
    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 24px;">
      <div style="width: 36px; height: 36px; background: #1E3A8A; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
        <span style="color: white; font-size: 18px;">🛡️</span>
      </div>
      <span style="font-size: 18px; font-weight: 600; color: #0F172A;">VoterGraph.ai</span>
    </div>

    <h2 style="color: #0F172A; font-size: 22px; font-weight: 600; margin: 0 0 8px;">Verify your email</h2>
    <p style="color: #64748B; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
      Enter this 6-digit code to complete your SIR Verification Access registration.
      The code expires in <strong>10 minutes</strong>.
    </p>

    <div style="background: white; border: 2px solid #1E3A8A; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
      <p style="color: #64748B; font-size: 12px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; margin: 0 0 8px;">Your verification code</p>
      <p style="color: #1E3A8A; font-size: 42px; font-weight: 700; letter-spacing: 0.3em; margin: 0; font-family: 'Courier New', monospace;">${otp}</p>
    </div>

    <p style="color: #94A3B8; font-size: 12px; text-align: center; margin: 0;">
      If you didn't request this, you can safely ignore this email.<br />
      Secured by Election Commission of India · TLS 1.3
    </p>
  </div>`;

  const command = new SendEmailCommand({
    Source: FROM,
    Destination: { ToAddresses: [toEmail] },
    Message: {
      Subject: { Data: 'Your VoterGraph.ai verification code', Charset: 'UTF-8' },
      Body: {
        Html: { Data: htmlBody,              Charset: 'UTF-8' },
        Text: { Data: `Your VoterGraph.ai verification code is: ${otp}\n\nThis code expires in 10 minutes.`, Charset: 'UTF-8' },
      },
    },
  });

  await sesClient.send(command);
  console.log(`[sesClient] ✅ OTP email sent to ${toEmail}`);
};

module.exports = { sendOtpEmail };
