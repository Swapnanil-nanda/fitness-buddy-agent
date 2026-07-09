/* ============================================
   FitBuddy — Local Development Proxy Server
   Run: node server.js
   Proxies /api/chat to IBM watsonx.ai
   ============================================ */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3001);
const STATIC_PORT = Number(process.env.STATIC_PORT || 3000);

// ── Database lives in .data/ — outside the static-served directory.
// This folder is gitignored and never served to clients.
const DATA_DIR = path.join(__dirname, '.data');
const DB_PATH  = path.join(DATA_DIR, 'db.json');

class JSONDatabase {
  constructor() {
    // Ensure the .data directory exists before writing
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify({ users: {} }, null, 2));
    }
    // Clean up verify* users on startup
    try {
      const data = this.read();
      let changed = false;
      for (const username of Object.keys(data.users)) {
        if (username.startsWith('verify')) {
          delete data.users[username];
          changed = true;
        }
      }
      if (changed) {
        this.write(data);
        console.log('🧹 Cleaned up verify* test users on startup.');
      }
    } catch (e) { /* ignore */ }
  }

  read() {
    try {
      const data = fs.readFileSync(DB_PATH, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      return { users: {} };
    }
  }

  write(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  }

  getUser(username) {
    const db = this.read();
    return db.users[username.toLowerCase()] || null;
  }

  saveUser(username, userData) {
    const db = this.read();
    const lowerUsername = username.toLowerCase();
    
    // Clean up other verify* users to prevent accumulation
    for (const key of Object.keys(db.users)) {
      if (key.startsWith('verify') && key !== lowerUsername) {
        delete db.users[key];
      }
    }
    
    db.users[lowerUsername] = userData;
    this.write(db);
  }
}

const db = new JSONDatabase();

let cachedToken = null;
let tokenExpiry = 0;

// Read env from .env file if it exists
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...rest] = trimmed.split('=');
          process.env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
        }
      }
    }
  } catch (e) { /* ignore */ }
}

loadEnv();

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'POST',
      headers: options.headers || {}
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: data });
      });
    });

    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function getIAMToken(apiKey) {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) return cachedToken;

  const res = await httpsRequest('https://iam.cloud.ibm.com/identity/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${apiKey}`);

  if (!res.ok) throw new Error(`IAM token failed: ${res.status}`);
  const data = JSON.parse(res.body);
  cachedToken = data.access_token;
  tokenExpiry = now + 50 * 60 * 1000;
  return cachedToken;
}

// ── Internal DB token — generated once at startup, stored in memory only.
// The frontend receives it via /api/db-token (localhost only).
// All /api/user-data calls must include it in the X-DB-Token header.
const DB_TOKEN = require('crypto').randomBytes(32).toString('hex');

// API Proxy Server
const apiServer = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DB-Token');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname.replace(/\/$/, '');

  // ── Token handshake endpoint — localhost only ──
  // The app calls this once on boot to get the session DB token.
  if (req.method === 'GET' && pathname === '/api/db-token') {
    const host = req.headers.host || '';
    const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
    if (!isLocal) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token: DB_TOKEN }));
    return;
  }

  // ── Token guard for all /api/user-data calls ──
  function isValidToken(request) {
    return request.headers['x-db-token'] === DB_TOKEN;
  }

  // ── Database Routes ──
  if (req.method === 'GET' && pathname === '/api/user-data') {
    if (!isValidToken(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    const username = parsedUrl.searchParams.get('username');
    if (!username) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Username is required' }));
      return;
    }
    const userData = db.getUser(username);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: userData }));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/user-data') {
    if (!isValidToken(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    let body = '';
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 65536) {
        tooLarge = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large (64 KB limit)' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        const { username, state } = JSON.parse(body);
        if (!username) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Username is required' }));
          return;
        }
        db.saveUser(username, state);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    let body = '';
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 65536) {
        tooLarge = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large (64 KB limit)' }));
        req.destroy();
      }
    });
    req.on('end', async () => {
      if (tooLarge) return;
      try {
        const { prompt, max_tokens = 400 } = JSON.parse(body);
        const apiKey = process.env.IBM_API_KEY;
        const projectId = process.env.IBM_PROJECT_ID;
        const region = process.env.IBM_REGION || 'us-south';

        if (!apiKey || !projectId) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Set IBM_API_KEY and IBM_PROJECT_ID in .env file' }));
          return;
        }

        const token = await getIAMToken(apiKey);
        const wxRes = await httpsRequest(
          `https://${region}.ml.cloud.ibm.com/ml/v1/text/generation?version=2025-02-06`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            }
          },
          JSON.stringify({
            model_id: process.env.IBM_MODEL_ID || 'ibm/granite-3-8b-instruct',
            input: prompt,
            project_id: projectId,
            parameters: {
              decoding_method: 'greedy',
              max_new_tokens: max_tokens,
              temperature: 0.7,
              top_p: 0.9,
              repetition_penalty: 1.1,
              stop_sequences: ['<|eot_id|>', '<|start_header_id|>', '\nUser:', '\nHuman:', '\n\n\n']
            }
          })
        );

        if (!wxRes.ok) {
          console.error('watsonx error:', wxRes.status, wxRes.body);
          res.writeHead(wxRes.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `watsonx.ai error: ${wxRes.status}` }));
          return;
        }

        const data = JSON.parse(wxRes.body);
        const generatedText = data.results?.[0]?.generated_text || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ generated_text: generatedText.trim() }));

      } catch (err) {
        console.error('Proxy error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use POST /api/chat' }));
  }
});

// Static File Server (serves the app)
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const staticServer = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const requestPath = parsedUrl.pathname === '/' ? 'index.html' : decodeURIComponent(parsedUrl.pathname);

  // ── Security: block access to sensitive paths ──
  const normalized = requestPath.replace(/\\/g, '/').toLowerCase();
  const BLOCKED = ['.data', 'db.json', '.env', '.gitignore', 'server.js'];
  const isBlocked = BLOCKED.some(b => normalized.includes(b));
  if (isBlocked) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return;
  }

  let filePath = path.join(__dirname, requestPath);

  // ── Security: prevent path traversal outside __dirname ──
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // SPA fallback
        fs.readFile(path.join(__dirname, 'index.html'), (e, c) => {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(c);
        });
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

apiServer.listen(PORT, () => {
  console.log(`\n🔌 API Proxy running at http://localhost:${PORT}/api/chat`);
});

staticServer.listen(STATIC_PORT, () => {
  console.log(`🏋️ FitBuddy running at http://localhost:${STATIC_PORT}`);
  console.log(`\n📝 Set IBM credentials in .env file:\n   IBM_API_KEY=your_key\n   IBM_PROJECT_ID=your_project_id\n   IBM_REGION=us-south\n`);
});
