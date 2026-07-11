// Vercel Serverless Function — POST /api/reset-password
// Handles password recovery code requests and password resets using Redis.

const db = require('./_db');
const { hashPassword } = require('./_lib');
const nodemailer = require('nodemailer');

module.exports = async function handler(req, res) {
  // CORS
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DB-Token');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action } = req.query;

  // ──────────── ACTION: SEND CODE ────────────
  if (action === 'send') {
    try {
      const { username, email } = req.body;
      if (!username || !email) {
        return res.status(400).json({ error: 'Username and email are required' });
      }

      const userRecord = await db.findByUsername(username);
      if (!userRecord) {
        return res.status(400).json({ error: 'Username or email not found' });
      }

      const storedEmail = (userRecord.state?.user?.email || '').toLowerCase();
      if (storedEmail !== email.toLowerCase()) {
        return res.status(400).json({ error: 'Username or email not found' });
      }

      // Generate a secure 6-digit numeric recovery code
      const code = Math.floor(100000 + Math.random() * 900000).toString();

      // Store in Redis (expires in 10 minutes)
      const client = db.getClient();
      const resetKey = `reset:${username.toLowerCase()}`;
      await client.setex(resetKey, 600, JSON.stringify({ code, email: email.toLowerCase() }));

      // SMTP Dispatch
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;

      if (!smtpUser || !smtpPass) {
        console.log(`[DEVELOPMENT MODE] Password reset code for ${username}: ${code}`);
        return res.status(200).json({
          success: true,
          devMode: true,
          code, // Return code in response during development if SMTP is not set up
          message: 'SMTP credentials not configured. Verification code logged to server console.'
        });
      }

      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_PORT === '465',
        auth: {
          user: smtpUser,
          pass: smtpPass
        }
      });

      const mailOptions = {
        from: process.env.SMTP_FROM || `"FitBuddy Support" <${smtpUser}>`,
        to: email,
        subject: 'FitBuddy Password Recovery Code',
        text: `Your password recovery code is: ${code}\n\nThis code will expire in 10 minutes. If you did not request this, you can ignore this email.`,
        html: `<p>Your password recovery code is: <strong>${code}</strong></p><p>This code will expire in 10 minutes. If you did not request this, you can ignore this email.</p>`
      };

      await transporter.sendMail(mailOptions);

      return res.status(200).json({
        success: true,
        message: 'Recovery code sent successfully to your email.'
      });

    } catch (err) {
      console.error('Password reset send code error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ──────────── ACTION: VERIFY CODE & RESET PASSWORD ────────────
  if (action === 'verify') {
    try {
      const { username, code, newPassword } = req.body;
      if (!username || !code || !newPassword) {
        return res.status(400).json({ error: 'Username, code, and new password are required' });
      }

      if (newPassword.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters long' });
      }

      const client = db.getClient();
      const resetKey = `reset:${username.toLowerCase()}`;
      const rawData = await client.get(resetKey);

      if (!rawData) {
        return res.status(400).json({ error: 'Invalid or expired recovery code' });
      }

      const storedData = JSON.parse(rawData);
      if (storedData.code !== code.trim()) {
        return res.status(400).json({ error: 'Invalid recovery code' });
      }

      const userRecord = await db.findByUsername(username);
      if (!userRecord) {
        return res.status(400).json({ error: 'User not found' });
      }

      // Re-hash password and update user record
      const { salt, hash } = hashPassword(newPassword);
      userRecord.salt = salt;
      userRecord.hash = hash;

      await client.set(`user:${userRecord.state.user.userId}`, JSON.stringify(userRecord));
      await client.del(resetKey);

      return res.status(200).json({
        success: true,
        message: 'Password has been reset successfully.'
      });

    } catch (err) {
      console.error('Password reset verify code error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Invalid action parameter' });
};
