



module.exports = function handler(req, res) {
  
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DB-Token');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.DB_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'DB_TOKEN not configured in environment variables' });
  }

  return res.status(200).json({ token });
};
