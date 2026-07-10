



const db = require('./_db');

function isValidToken(req) {
  const token = process.env.DB_TOKEN;
  if (!token) return true; 
  return req.headers['x-db-token'] === token;
}

module.exports = async function handler(req, res) {
  
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DB-Token, X-User-Password');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  
  if (!isValidToken(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  
  if (req.method === 'GET') {
    try {
      const username = req.query.username;
      if (!username) {
        return res.status(400).json({ error: 'Username is required' });
      }

      const password = req.headers['x-user-password'];
      const userRecord = await db.findByUsername(username);

      if (!userRecord) {
        return res.status(200).json({ success: true, exists: false, data: null });
      }

      
      if (userRecord.hash) {
        if (!password) {
          return res.status(401).json({ success: false, error: 'Password required' });
        }
        const { hashPassword } = require('./_lib');
        const { hash } = hashPassword(password, userRecord.salt);
        if (hash !== userRecord.hash) {
          return res.status(401).json({ success: false, error: 'Incorrect password for this username' });
        }
      }

      return res.status(200).json({ success: true, exists: true, data: userRecord.state });
    } catch (err) {
      console.error('GET /api/user-data error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  
  if (req.method === 'POST') {
    try {
      const { username, password, newPassword, state } = req.body;

      if (!username) {
        return res.status(400).json({ error: 'Username is required' });
      }
      if (!state || !state.user) {
        return res.status(400).json({ error: 'Valid state object is required' });
      }

      const userId = state.user.userId;
      let resultState;
      let exists = false;

      if (userId) {
        resultState = await db.updateUser(userId, username, password, newPassword, state);
        exists = true;
      } else {
        const onboardResult = await db.onboardUser(username, password, state);
        resultState = onboardResult.state;
        exists = onboardResult.exists;
      }

      return res.status(200).json({ success: true, exists, state: resultState });
    } catch (err) {
      console.error('POST /api/user-data error:', err);
      const msg = err.message.toLowerCase();
      const status = msg.includes('password') || msg.includes('taken') ? 401 : 500;
      return res.status(status).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
