const Redis = require('ioredis');
const crypto = require('crypto');
const { hashPassword } = require('./_lib');


let _client = null;

function getClient() {
  if (!_client) {
    _client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      tls: process.env.REDIS_URL?.startsWith('rediss://') ? {} : undefined,
    });
  }
  return _client;
}

async function findByUsername(username) {
  const client = getClient();
  const keys = await client.keys('user:*');

  for (const key of keys) {
    const raw = await client.get(key);
    if (!raw) continue;

    const record = JSON.parse(raw);
    if (
      record.state &&
      record.state.user &&
      record.state.user.username &&
      record.state.user.username.toLowerCase() === username.toLowerCase()
    ) {
      return record;
    }
  }

  return null;
}

async function findByUserId(userId) {
  const client = getClient();
  const raw = await client.get(`user:${userId}`);
  if (!raw) return null;
  return JSON.parse(raw);
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
    throw new Error('User not found');
  }

  
  if (existing.hash) {
    const attempt = hashPassword(password, existing.salt);
    if (attempt.hash !== existing.hash) {
      throw new Error('Incorrect password');
    }
  }

  
  if (
    username &&
    existing.state.user.username.toLowerCase() !== username.toLowerCase()
  ) {
    const taken = await findByUsername(username);
    if (taken && taken.state.user.userId !== userId) {
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

  const record = { hash, salt, state };
  await client.set(`user:${userId}`, JSON.stringify(record));

  return state;
}

async function findByGoogleId(googleId) {
  const client = getClient();
  const keys = await client.keys('user:*');
  for (const key of keys) {
    const raw = await client.get(key);
    if (!raw) continue;
    const record = JSON.parse(raw);
    if (record.googleId === googleId) {
      return record;
    }
  }
  return null;
}

async function findByEmail(email) {
  const client = getClient();
  const keys = await client.keys('user:*');
  for (const key of keys) {
    const raw = await client.get(key);
    if (!raw) continue;
    const record = JSON.parse(raw);
    if (record.state && record.state.user && record.state.user.email && record.state.user.email.toLowerCase() === email.toLowerCase()) {
      return record;
    }
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
