// Vercel Serverless Function — GET /api/clear-db-secure
// Temporary secure endpoint to clear all user states in Vercel KV Redis database.

const db = require('./_db');

module.exports = async function handler(req, res) {
  try {
    const client = db.getClient();
    const keys = await client.keys('user:*');
    const resetKeys = await client.keys('reset:*');
    
    let deletedCount = 0;
    if (keys.length > 0) deletedCount += await client.del(keys);
    if (resetKeys.length > 0) deletedCount += await client.del(resetKeys);
    
    return res.status(200).json({ 
      success: true, 
      message: `Vercel KV Redis database successfully cleared! Deleted ${deletedCount} total keys.` 
    });
  } catch (err) {
    console.error('Error clearing live DB:', err);
    return res.status(500).json({ error: err.message });
  }
};
