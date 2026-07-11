// Vercel Serverless Function — POST /api/google-login
// Authenticates users using Google Sign-In with Redis storage.

const db = require('./_db');
const { hashPassword } = require('./_lib');
const crypto = require('crypto');

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

  try {
    const { googleId, email, name } = req.body;
    if (!googleId || !email) {
      return res.status(400).json({ error: 'Google ID and Email are required' });
    }

    const client = db.getClient();

    // 1. Check if user already exists with this googleId
    let userRecord = await db.findByGoogleId(googleId);
    if (userRecord) {
      return res.status(200).json({ success: true, state: userRecord.state });
    }

    // 2. Check if a standard user already exists with this email address
    userRecord = await db.findByEmail(email);
    if (userRecord) {
      // Auto-link Google Account
      userRecord.googleId = googleId;
      await client.set(`user:${userRecord.state.user.userId}`, JSON.stringify(userRecord));
      return res.status(200).json({ success: true, state: userRecord.state });
    }

    // 3. Auto-register a new user
    const userId = 'usr_' + crypto.randomBytes(8).toString('hex');
    const { salt, hash } = hashPassword('google-auth-placeholder-' + crypto.randomBytes(4).toString('hex'));

    const state = {
      user: {
        username: name || email.split('@')[0],
        email: email,
        weight: 70,
        height: 175,
        age: 25,
        gender: 'male',
        bmi: 22.9,
        goal: 'maintain',
        tdee: 2000,
        macros: { protein: 150, carbs: 200, fat: 67 },
        cuisine: 'any',
        diet: 'no-restriction',
        userId: userId
      },
      today: {
        date: new Date().toISOString().split('T')[0],
        meals: [],
        exercises: [],
        water: 0,
        sleep: 7,
        mood: 'neutral',
        xpEarned: 0,
        challenges: []
      },
      xp: {
        current: 0,
        level: 1,
        total: 0
      },
      settings: {
        mode: 'proxy'
      },
      chatHistory: [],
      onboarded: false // Setting to false forces user to confirm details or do a quick edit
    };

    const record = {
      userId,
      googleId,
      salt,
      hash,
      state
    };

    await client.set(`user:${userId}`, JSON.stringify(record));
    return res.status(200).json({ success: true, state });

  } catch (err) {
    console.error('Google login backend error:', err);
    return res.status(500).json({ error: err.message });
  }
};
