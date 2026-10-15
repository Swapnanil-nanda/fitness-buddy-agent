const Redis = require('ioredis');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { hashPassword } = require('./_lib');

// Resilient in-memory fallback store
const _fallbackMemory = new Map();
const TMP_FILE = path.join(process.env.TEMP || '/tmp', 'fitbuddy_store.json');

function initFallbackStore() {
  if (_fallbackMemory.size > 0) return;

  // 1. Try reading existing tmp cache
  try {
    if (fs.existsSync(TMP_FILE)) {
      const raw = fs.readFileSync(TMP_FILE, 'utf8');
      const data = JSON.parse(raw);
      for (const [k, v] of Object.entries(data)) {
        if (!v.expiresAt || v.expiresAt > Date.now()) {
          _fallbackMemory.set(k, v);
        }
      }
    }
  } catch (e) {}

  // 2. Pre-seed demo users from db.json if memory is still empty
  if (_fallbackMemory.size === 0) {
    try {
      const dbJsonPath = path.join(process.cwd(), 'db.json');
      if (fs.existsSync(dbJsonPath)) {
        const raw = fs.readFileSync(dbJsonPath, 'utf8');
        const dbJson = JSON.parse(raw);
        if (dbJson && dbJson.users) {
          for (const [username, userData] of Object.entries(dbJson.users)) {
            const userId = userData.user?.userId || 'usr_' + crypto.createHash('md5').update(username).digest('hex').substring(0, 12);
            const { hash, salt } = hashPassword('demo1234');
            const state = { ...userData };
            if (!state.user.userId) state.user.userId = userId;
            const record = { userId, salt, hash, state };
            _fallbackMemory.set(`user:${userId}`, { value: JSON.stringify(record), expiresAt: null });
          }
        }
      }
    } catch (e) {}
  }
}

function persistFallbackStore() {
  try {
    const obj = {};
    for (const [k, v] of _fallbackMemory.entries()) {
      if (!v.expiresAt || v.expiresAt > Date.now()) {
        obj[k] = v;
      }
    }
    fs.writeFileSync(TMP_FILE, JSON.stringify(obj));
  } catch (e) {}
}

const fallbackClient = {
  async get(key) {
    initFallbackStore();
    const item = _fallbackMemory.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      _fallbackMemory.delete(key);
      persistFallbackStore();
      return null;
    }
    return item.value;
  },
  async set(key, value) {
    initFallbackStore();
    _fallbackMemory.set(key, { value, expiresAt: null });
    persistFallbackStore();
    return 'OK';
  },
  async setex(key, ttlSeconds, value) {
    initFallbackStore();
    _fallbackMemory.set(key, { value, expiresAt: Date.now() + (ttlSeconds * 1000) });
    persistFallbackStore();
    return 'OK';
  },
  async keys(pattern) {
    initFallbackStore();
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    const result = [];
    for (const [k, v] of _fallbackMemory.entries()) {
      if (v.expiresAt && Date.now() > v.expiresAt) {
        _fallbackMemory.delete(k);
        continue;
      }
      if (regex.test(k)) result.push(k);
    }
    return result;
  },
  async del(keys) {
    initFallbackStore();
    const arr = Array.isArray(keys) ? keys : [keys];
    let count = 0;
    for (const k of arr) {
      if (_fallbackMemory.delete(k)) count++;
    }
    persistFallbackStore();
    return count;
  }
};

let _redisInstance = null;
let _redisFailed = false;

function getRedisInstance() {
  const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
  if (!redisUrl || _redisFailed) {
    return null;
  }
  if (!_redisInstance) {
    try {
      _redisInstance = new Redis(redisUrl, {
        connectTimeout: 2500,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
        lazyConnect: true,
        tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
      });
      _redisInstance.on('error', (err) => {
        console.warn('[DB] Redis error event, switching to resilient local store:', err.message);
        _redisFailed = true;
      });
    } catch (e) {
      console.warn('[DB] Failed to instantiate Redis client:', e.message);
      _redisFailed = true;
      return null;
    }
  }
  return _redisInstance;
}

// Unified client proxy: Attempts Redis first; automatically falls back if Redis is paused or times out
const unifiedClient = {
  async get(key) {
    const redis = getRedisInstance();
    if (redis && !_redisFailed) {
      try {
        const res = await redis.get(key);
        return res;
      } catch (e) {
        console.warn('[DB] Redis get failed, using fallback store:', e.message);
        _redisFailed = true;
      }
    }
    return fallbackClient.get(key);
  },

  async set(key, value) {
    fallbackClient.set(key, value);
    const redis = getRedisInstance();
    if (redis && !_redisFailed) {
      try {
        return await redis.set(key, value);
      } catch (e) {
        console.warn('[DB] Redis set failed:', e.message);
        _redisFailed = true;
      }
    }
    return 'OK';
  },

  async setex(key, ttl, value) {
    fallbackClient.setex(key, ttl, value);
    const redis = getRedisInstance();
    if (redis && !_redisFailed) {
      try {
        return await redis.setex(key, ttl, value);
      } catch (e) {
        console.warn('[DB] Redis setex failed:', e.message);
        _redisFailed = true;
      }
    }
    return 'OK';
  },

  async keys(pattern) {
    const redis = getRedisInstance();
    if (redis && !_redisFailed) {
      try {
        return await redis.keys(pattern);
      } catch (e) {
        console.warn('[DB] Redis keys failed, using fallback store:', e.message);
        _redisFailed = true;
      }
    }
    return fallbackClient.keys(pattern);
  },

  async del(keys) {
    fallbackClient.del(keys);
    const redis = getRedisInstance();
    if (redis && !_redisFailed) {
      try {
        return await redis.del(keys);
      } catch (e) {
        console.warn('[DB] Redis del failed:', e.message);
        _redisFailed = true;
      }
    }
    return 1;
  }
};

function getClient() {
  return unifiedClient;
}

async function findByUsername(username) {
  const client = getClient();
  const keys = await client.keys('user:*');

  for (const key of keys) {
    const raw = await client.get(key);
    if (!raw) continue;

    try {
      const record = JSON.parse(raw);
      if (
        record.state &&
        record.state.user &&
        record.state.user.username &&
        record.state.user.username.toLowerCase() === username.toLowerCase()
      ) {
        return record;
      }
    } catch(e) {}
  }

  return null;
}

async function findByUserId(userId) {
  const client = getClient();
  const raw = await client.get(`user:${userId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch(e) {
    return null;
  }
}

async function onboardUser(username, password, state) {
  const client = getClient();
  const existing = await findByUsername(username);

  if (existing) {
    if (existing.hash) {
      const attempt = hashPassword(password, existing.salt);
      if (attempt.hash !== existing.hash) {
        throw new Error('Incorrect password for this username');
      }
    }
    return { exists: true, state: existing.state };
  }

  const userId = 'usr_' + crypto.randomBytes(8).toString('hex');
  const { hash, salt } = hashPassword(password);

  state.user.userId = userId;
  state.user.username = username;

  const record = { hash, salt, state };
  await client.set(`user:${userId}`, JSON.stringify(record));

  return { exists: false, state };
}

async function updateUser(userId, username, password, newPassword, state) {
  const client = getClient();
  const existing = await findByUserId(userId);

  if (!existing) {
    // If not found by userId, try finding by username
    const byName = await findByUsername(username);
    if (byName) {
      return updateUser(byName.userId || byName.state?.user?.userId, username, password, newPassword, state);
    }
    // Auto-create if user is saving profile
    return (await onboardUser(username, password || 'defaultpass', state)).state;
  }

  if (existing.hash && password !== 'google-auth-session') {
    const attempt = hashPassword(password, existing.salt);
    if (attempt.hash !== existing.hash) {
      throw new Error('Incorrect password');
    }
  }

  if (
    username &&
    existing.state?.user?.username?.toLowerCase() !== username.toLowerCase()
  ) {
    const taken = await findByUsername(username);
    if (taken && (taken.userId || taken.state?.user?.userId) !== userId) {
      throw new Error('Username is already taken');
    }
    state.user.username = username;
  }

  let hash = existing.hash;
  let salt = existing.salt;
  if (newPassword) {
    const hashed = hashPassword(newPassword);
    hash = hashed.hash;
    salt = hashed.salt;
  }

  const record = { hash, salt, state, googleId: existing.googleId };
  await client.set(`user:${userId}`, JSON.stringify(record));

  return state;
}

async function findByGoogleId(googleId) {
  const client = getClient();
  const keys = await client.keys('user:*');
  for (const key of keys) {
    const raw = await client.get(key);
    if (!raw) continue;
    try {
      const record = JSON.parse(raw);
      if (record.googleId === googleId) {
        return record;
      }
    } catch(e) {}
  }
  return null;
}

async function findByEmail(email) {
  const client = getClient();
  const keys = await client.keys('user:*');
  for (const key of keys) {
    const raw = await client.get(key);
    if (!raw) continue;
    try {
      const record = JSON.parse(raw);
      if (
        record.state &&
        record.state.user &&
        record.state.user.email &&
        record.state.user.email.toLowerCase() === email.toLowerCase()
      ) {
        return record;
      }
    } catch(e) {}
  }
  return null;
}

module.exports = {
  getClient,
  findByUsername,
  findByUserId,
  onboardUser,
  updateUser,
  findByGoogleId,
  findByEmail,
};
