



module.exports = async function handler(req, res) {
  
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

  let redisStatus = 'not_configured';
  const url = process.env.REDIS_URL || process.env.KV_URL;
  if (url) {
    try {
      const Redis = require('ioredis');
      const testClient = new Redis(url, {
        connectTimeout: 2500,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
        lazyConnect: false,
        tls: url.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined
      });
      testClient.on('error', () => {});
      await testClient.ping();
      redisStatus = 'connected';
      testClient.disconnect();
    } catch (err) {
      redisStatus = 'error: ' + err.message;
    }
  }

  return res.status(200).json({ 
    token,
    status: 'ok',
    hasRedisUrl: !!url,
    redisStatus
  });
};
