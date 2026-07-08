/* ============================================
   FitBuddy — Local Development Proxy Server
   Run: node server.js
   Proxies /api/chat to IBM watsonx.ai
   ============================================ */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const STATIC_PORT = 3000;

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

// API Proxy Server
const apiServer = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname.replace(/\/$/, '');
  if (req.method === 'POST' && pathname === '/api/chat') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
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
            model_id: 'meta-llama/llama-3-3-70b-instruct',
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
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
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
